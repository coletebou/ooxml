import { createMemoryTransport } from 'ooxml-core/mail';
import { sameMailConnection, type MailConnection } from './store';

const jmap = (auth: Extract<MailConnection, { kind: 'jmap' }>['auth']): MailConnection => ({
	kind: 'jmap',
	url: 'https://mail.example.com',
	auth,
});

describe('sameMailConnection', () => {
	it('treats no connection as the same as no connection', () => {
		expect(sameMailConnection(null, undefined)).toBe(true);
		expect(sameMailConnection(null, { kind: 'demo' })).toBe(false);
	});

	it('compares a demo mailbox by its seed options', () => {
		const files = { xlsx: new Uint8Array([1]) };
		expect(sameMailConnection({ kind: 'demo' }, { kind: 'demo', seed: {} })).toBe(true);
		expect(
			sameMailConnection(
				{ kind: 'demo', seed: { now: 1, files } },
				{ kind: 'demo', seed: { now: 1, files: { ...files } } },
			),
		).toBe(true);
		expect(
			sameMailConnection({ kind: 'demo', seed: { now: 1 } }, { kind: 'demo', seed: { now: 2 } }),
		).toBe(false);
		expect(sameMailConnection({ kind: 'demo', seed: { bulk: 10 } }, { kind: 'demo' })).toBe(false);
		expect(
			sameMailConnection(
				{ kind: 'demo', seed: { files } },
				{ kind: 'demo', seed: { files: { xlsx: new Uint8Array([1]) } } },
			),
		).toBe(false);
	});

	it('compares a server by its address and credentials, written inline or not', () => {
		expect(
			sameMailConnection(
				jmap({ type: 'bearer', token: 't' }),
				jmap({ type: 'bearer', token: 't' }),
			),
		).toBe(true);
		expect(
			sameMailConnection(
				jmap({ type: 'bearer', token: 't' }),
				jmap({ type: 'bearer', token: 'u' }),
			),
		).toBe(false);
		expect(
			sameMailConnection(
				jmap({ type: 'basic', username: 'ada', password: 'p' }),
				jmap({ type: 'basic', username: 'ada', password: 'p' }),
			),
		).toBe(true);
		expect(
			sameMailConnection(
				jmap({ type: 'basic', username: 'ada', password: 'p' }),
				jmap({ type: 'basic', username: 'ada', password: 'q' }),
			),
		).toBe(false);
		expect(
			sameMailConnection(
				jmap({ type: 'bearer', token: 'p' }),
				jmap({ type: 'basic', username: 'p', password: 'p' }),
			),
		).toBe(false);
		const other: MailConnection = {
			kind: 'jmap',
			url: 'https://other.example.com',
			auth: { type: 'bearer', token: 't' },
		};
		expect(sameMailConnection(jmap({ type: 'bearer', token: 't' }), other)).toBe(false);
	});

	it('compares a transport of your own by identity', () => {
		const transport = createMemoryTransport();
		expect(
			sameMailConnection({ kind: 'transport', transport }, { kind: 'transport', transport }),
		).toBe(true);
		expect(
			sameMailConnection(
				{ kind: 'transport', transport },
				{ kind: 'transport', transport: createMemoryTransport() },
			),
		).toBe(false);
		expect(sameMailConnection({ kind: 'transport', transport }, { kind: 'demo' })).toBe(false);
	});
});
