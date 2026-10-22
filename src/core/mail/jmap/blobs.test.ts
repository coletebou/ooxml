import { json, rfcSession } from './test-support/fake-server';
import { failure, setup, TOKEN } from './test-support/setup';

const bytes = new TextEncoder().encode('Subject: hi\r\n\r\nHello\r\n');

describe('upload', () => {
	it('posts the bytes to the upload URL of the account with their type', async () => {
		const { server, transport } = setup();
		const blob = await transport.upload(bytes, 'text/plain');
		expect(blob).toEqual({ blobId: 'G1', type: 'text/plain', size: bytes.length });
		const [request] = server.requests.filter((item) => item.method === 'POST');
		expect(request).toMatchObject({ url: 'https://jmap.example.com/upload/A13824/' });
		expect(request!.headers['content-type']).toBe('text/plain');
		expect(request!.headers.authorization).toBe(`Bearer ${TOKEN}`);
		expect(Array.from(request!.bytes!)).toEqual(Array.from(bytes));
		expect((await transport.upload(new Uint8Array([1, 2]), '')).type).toBe(
			'application/octet-stream',
		);
	});

	it('refuses a file above maxSizeUpload before sending it, and maps 413', async () => {
		const { server, transport } = setup();
		server.session = rfcSession();
		(server.session.capabilities as Record<string, Record<string, unknown>>)[
			'urn:ietf:params:jmap:core'
		]!.maxSizeUpload = 4;
		expect(await failure(transport.upload(bytes, 'text/plain'))).toMatchObject({
			code: 'tooLarge',
		});
		expect(server.requests.filter((item) => item.method === 'POST')).toEqual([]);
		server.route(
			(request) => request.method === 'POST',
			() => json({ type: 'about:blank' }, 413),
		);
		expect(await failure(transport.upload(new Uint8Array(2), 'image/png'))).toMatchObject({
			code: 'tooLarge',
			status: 413,
		});
		server.route(
			(request) => request.method === 'POST',
			() => json({ size: 2 }),
		);
		expect(await failure(transport.upload(new Uint8Array(2), 'image/png'))).toMatchObject({
			code: 'server',
		});
	});

	it('sends a view of a larger buffer as just its bytes', async () => {
		const { server, transport } = setup();
		const whole = new Uint8Array([9, 9, 1, 2, 3, 9]);
		await transport.upload(whole.subarray(2, 5), 'application/octet-stream');
		expect(Array.from(server.requests.at(-1)!.bytes!.slice())).toEqual([1, 2, 3]);
	});
});

describe('download', () => {
	it('fills the download template with URL-encoded values and returns the bytes', async () => {
		const { server, transport } = setup();
		server.route(
			(request) => request.url.startsWith('https://jmap.example.com/download/'),
			() =>
				new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'application/pdf' } }),
		);
		const data = await transport.download('Gab/c+d', {
			type: 'application/pdf',
			name: 'résumé final?.pdf',
		});
		expect(Array.from(data)).toEqual([1, 2, 3]);
		expect(server.requests.at(-1)).toMatchObject({
			method: 'GET',
			url: 'https://jmap.example.com/download/A13824/Gab%2Fc%2Bd/r%C3%A9sum%C3%A9%20final%3F.pdf?accept=application%2Fpdf',
		});
		expect(server.requests.at(-1)!.headers.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it('maps a missing blob to notFound', async () => {
		const { transport } = setup();
		expect(await failure(transport.download('missing', { type: '', name: '' }))).toMatchObject({
			code: 'notFound',
			status: 404,
		});
	});
});

describe('importMessage', () => {
	it('uploads the message as message/rfc822 and imports it with Email/import', async () => {
		const { server, transport } = setup();
		server.on('Email/import', (args) => ({
			created: {
				eml: { id: 'Mimported', blobId: (args.emails as { eml: { blobId: string } }).eml.blobId },
			},
		}));
		expect(await transport.importMessage(bytes, 'MBinbox')).toEqual({ id: 'Mimported' });
		expect(
			server.requests.find((item) => item.method === 'POST' && item.url.includes('/upload/'))!
				.headers['content-type'],
		).toBe('message/rfc822');
		expect(server.argsOf('Email/import')).toEqual([
			{
				accountId: 'A13824',
				emails: { eml: { blobId: 'G1', mailboxIds: { MBinbox: true }, keywords: { $seen: true } } },
			},
		]);
	});

	it('files no other message the server takes for the one imported', async () => {
		// RFC 8621 4.8: a server may call a message a duplicate by its Message-ID alone.
		const { server, transport } = setup();
		server.on('Email/import', () => ({
			notCreated: { eml: { type: 'alreadyExists', existingId: 'Mexisting' } },
		}));
		server.on('Email/get', () => ({ list: [{ id: 'Mexisting', blobId: 'Gother', size: 999 }] }));
		expect(await failure(transport.importMessage(bytes, 'MBwork'))).toMatchObject({
			code: 'invalid',
		});
		expect(server.argsOf('Email/set')).toEqual([]);
	});

	it('files a message the account already has instead of failing', async () => {
		const { server, transport } = setup();
		server.on('Email/import', () => ({
			notCreated: { eml: { type: 'alreadyExists', existingId: 'Mexisting' } },
		}));
		// The same message: the server names its bytes as the upload's (by their content).
		server.on('Email/get', () => ({
			list: [{ id: 'Mexisting', blobId: 'G1', size: bytes.length }],
		}));
		server.on('Email/set', () => ({ updated: { Mexisting: null } }));
		expect(await transport.importMessage(bytes, 'MBwork')).toEqual({ id: 'Mexisting' });
		expect(server.argsOf('Email/set')).toEqual([
			{ accountId: 'A13824', update: { Mexisting: { 'mailboxIds/MBwork': true } } },
		]);
		server.on('Email/import', () => ({ notCreated: { eml: { type: 'invalidEmail' } } }));
		expect(await failure(transport.importMessage(bytes, 'MBwork'))).toMatchObject({
			code: 'invalid',
		});
	});
});
