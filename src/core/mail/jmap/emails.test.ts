import { PartialUpdateError } from '../transport';
import { installMailStore } from './test-support/mail-store';
import { failure, setup } from './test-support/setup';
import { CORE } from './types';

describe('update', () => {
	const flag = { keywords: { $flagged: true } };

	it('changes every message it can, request after request, and names those it changed', async () => {
		const { server, transport } = setup();
		const store = installMailStore(server);
		store.emails.set('second', { mailboxIds: { MBinbox: true }, keywords: {} });
		// One message per call and one call per request: three requests.
		const core = (server.session.capabilities as Record<string, Record<string, unknown>>)[CORE]!;
		core.maxObjectsInSet = 1;
		server.limitCalls(1);
		const error = await failure(transport.update({ gone: flag, original: flag, second: flag }));
		expect(error).toBeInstanceOf(PartialUpdateError);
		expect(error).toMatchObject({
			code: 'notFound',
			updated: ['original', 'second'],
			cause: { type: 'notFound', target: 'gone' },
		});
		expect(server.argsOf('Email/set').map((args) => Object.keys(args.update as object))).toEqual([
			['gone'],
			['original'],
			['second'],
		]);
		expect(store.emails.get('second')!.keywords).toEqual({ $flagged: true });
	});

	it('fails with the server error itself when it changed nothing', async () => {
		const { server, transport } = setup();
		installMailStore(server);
		const error = await failure(transport.update({ gone: flag }));
		expect(error).not.toBeInstanceOf(PartialUpdateError);
		expect(error).toMatchObject({ code: 'notFound', type: 'notFound', target: 'gone' });
	});
});
