import rfc from './__fixtures__/rfc8620-requests.json';
import submission from './__fixtures__/rfc8621-submission.json';
import mailbox from './__fixtures__/rfc8621-mailbox.json';
import {
	JmapError,
	createRedactor,
	httpCode,
	methodError,
	responseError,
	safeCause,
	serverText,
	setError,
} from './errors';
import { MailTransportError, isMailTransportError } from '../transport';

const redact = createRedactor(['s3cr3t']);

describe('httpCode', () => {
	it('maps the statuses the UI words', () => {
		expect([401, 403, 404, 413, 429, 500, 502, 503, 400, 405, 302].map(httpCode)).toEqual([
			'unauthorized',
			'forbidden',
			'notFound',
			'tooLarge',
			'rateLimited',
			'server',
			'server',
			'server',
			'invalid',
			'invalid',
			'server',
		]);
	});
});

describe('responseError', () => {
	it('reads the RFC 8620 3.6.1.1 problem details', async () => {
		const unknown = await responseError(
			new Response(JSON.stringify(rfc.unknownCapability), { status: 400 }),
			'The JMAP request',
			redact,
		);
		expect(unknown).toBeInstanceOf(MailTransportError);
		expect(unknown).toMatchObject({
			code: 'unsupported',
			level: 'request',
			type: 'urn:ietf:params:jmap:error:unknownCapability',
			status: 400,
		});
		expect(unknown.message).toBe(
			"The JMAP request failed with HTTP 400 (unknownCapability): The Request object used capability 'https://example.com/apis/foobar', which is not supported by this server.",
		);
		const limit = await responseError(
			new Response(JSON.stringify(rfc.limit), { status: 400 }),
			'The JMAP request',
			redact,
		);
		expect(limit).toMatchObject({ code: 'tooLarge', details: { limit: 'maxSizeRequest' } });
	});

	it('maps the other request-level problems and plain statuses', async () => {
		const problem = (type: string, status: number, extra: object = {}) =>
			responseError(
				new Response(JSON.stringify({ type, status, ...extra }), { status }),
				'X',
				redact,
			);
		expect((await problem('urn:ietf:params:jmap:error:notJSON', 400)).code).toBe('invalid');
		expect((await problem('urn:ietf:params:jmap:error:notRequest', 400)).code).toBe('invalid');
		expect(
			(await problem('urn:ietf:params:jmap:error:limit', 400, { limit: 'maxConcurrentRequests' }))
				.code,
		).toBe('rateLimited');
		const plain = await responseError(
			new Response('<h1>Bad Gateway</h1>', { status: 502 }),
			'X',
			redact,
		);
		expect(plain).toMatchObject({ code: 'server', level: 'http', type: '', status: 502 });
		expect(plain.message).toBe('X failed with HTTP 502.');
	});
});

describe('methodError', () => {
	it('maps the RFC 8620 3.6.2 method errors, unknown ones as serverFail', () => {
		const codes = Object.fromEntries(
			[
				'serverUnavailable',
				'serverFail',
				'serverPartialFail',
				'unknownMethod',
				'invalidArguments',
				'invalidResultReference',
				'forbidden',
				'accountNotFound',
				'accountNotSupportedByMethod',
				'accountReadOnly',
				'requestTooLarge',
				'cannotCalculateChanges',
				'stateMismatch',
				'unsupportedFilter',
				'somethingNew',
				'constructor',
			].map((type) => [type, methodError('Email/get', { type }, redact).code]),
		);
		expect(codes).toEqual({
			serverUnavailable: 'server',
			serverFail: 'server',
			serverPartialFail: 'server',
			unknownMethod: 'unsupported',
			invalidArguments: 'invalid',
			invalidResultReference: 'invalid',
			forbidden: 'forbidden',
			accountNotFound: 'notFound',
			accountNotSupportedByMethod: 'unsupported',
			accountReadOnly: 'forbidden',
			requestTooLarge: 'tooLarge',
			cannotCalculateChanges: 'server',
			stateMismatch: 'invalid',
			unsupportedFilter: 'unsupported',
			somethingNew: 'server',
			constructor: 'server',
		});
		expect(
			methodError('Email/get', { type: 'invalidArguments', description: 'bad ids' }, redact)
				.message,
		).toBe('Email/get failed: invalidArguments (bad ids).');
		expect(methodError('Email/get', null, redact).type).toBe('serverFail');
	});
});

describe('setError', () => {
	it('maps the SetErrors of RFC 8620 5.3 and RFC 8621', () => {
		const code = (type: string) => setError('Email/set', 'k1', { type }, redact).code;
		expect(
			[
				'forbidden',
				'overQuota',
				'tooLarge',
				'rateLimit',
				'notFound',
				'invalidProperties',
				'mailboxHasEmail',
				'blobNotFound',
				'invalidEmail',
				'tooManyRecipients',
				'noRecipients',
				'invalidRecipients',
				'forbiddenMailFrom',
				'forbiddenFrom',
				'forbiddenToSend',
				'unheardOf',
			].map(code),
		).toEqual([
			'forbidden',
			'overQuota',
			'tooLarge',
			'rateLimited',
			'notFound',
			'invalid',
			'invalid',
			'notFound',
			'invalid',
			'invalid',
			'invalid',
			'invalid',
			'forbidden',
			'forbidden',
			'forbidden',
			'server',
		]);
	});

	it('keeps the extras and the description of the RFC 8621 7.5.1 forbiddenToSend example', () => {
		const refused = (submission.forbiddenResponse[1] as { notCreated: { k1490: unknown } })
			.notCreated.k1490;
		const error = setError('EmailSubmission/set', 'k1490', refused, redact);
		expect(error).toMatchObject({
			code: 'forbidden',
			level: 'set',
			type: 'forbiddenToSend',
			target: 'k1490',
		});
		expect(error.details.description).toMatch(/^Verzeihung/);
		const many = setError(
			'EmailSubmission/set',
			'k',
			{ type: 'tooManyRecipients', maxRecipients: 50, x: 1 },
			redact,
		);
		expect(many.details).toEqual({ maxRecipients: 50 });
		const forbidden = (mailbox.setResponse[1] as { notDestroyed: Record<string, unknown> })
			.notDestroyed;
		expect(
			setError('Mailbox/set', 'MB23cfa8094c0f41e6', forbidden.MB23cfa8094c0f41e6, redact).message,
		).toBe('Mailbox/set rejected MB23cfa8094c0f41e6: forbidden.');
	});
});

describe('scrubbing', () => {
	it('removes secrets from server text, details and causes, longest first', () => {
		const both = createRedactor(['abc', 'abcdef']);
		expect(both('x abcdef y abc')).toBe('x [redacted] y [redacted]');
		expect(serverText(`token s3cr3t\n\tleaked ${'z'.repeat(400)}`, redact)).toMatch(
			/^token \[redacted\] leaked z+\u2026$/,
		);
		expect(serverText(42, redact)).toBe('');
		const error = setError(
			'Email/set',
			'k',
			{ type: 'invalidProperties', properties: ['s3cr3t'], description: 's3cr3t' },
			redact,
		);
		expect(JSON.stringify(error.details)).not.toContain('s3cr3t');
		expect(error.message).not.toContain('s3cr3t');
		const nested = new Error('outer s3cr3t', { cause: new Error('inner s3cr3t') });
		const cause = safeCause(nested, redact);
		expect(cause.message).toBe('outer [redacted]');
		expect((cause.cause as Error).message).toBe('inner [redacted]');
		expect(String(cause.stack)).not.toContain('s3cr3t');
		expect(safeCause('plain s3cr3t', redact).message).toBe('plain [redacted]');
	});

	it('is a MailTransportError the UI can recognise', () => {
		const error = new JmapError('server', 'x', { level: 'http' });
		expect(isMailTransportError(error)).toBe(true);
		expect(error).toMatchObject({
			name: 'JmapError',
			type: '',
			status: null,
			target: null,
			details: {},
		});
	});
});
