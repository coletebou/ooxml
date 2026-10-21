// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMail } from 'ooxml-ui/mail';

// Every binding exposes the raw client from `createMail`, so the mail, calendar and contacts
// actions reach React `useMail` (and the bindings that follow) without each listing them.
const rawHooks = { react: 'react/src/index.ts' } as const;

describe.each(Object.entries(rawHooks))('%s raw hook', (_name, file) => {
	it('hands out the core client built by createMail', () => {
		const source = readFileSync(resolve(process.cwd(), 'packages', file), 'utf8');
		expect(source).toContain('createMail(');
	});
});

describe('the raw client', () => {
	it('carries the mail, calendar and contacts API and opens the demo mailbox', async () => {
		const client = createMail({ config: { kind: 'demo', seed: { now: Date.UTC(2026, 9, 20) } } });
		try {
			for (const action of [
				'selectMailbox',
				'search',
				'open',
				'markRead',
				'moveTo',
				'archive',
				'remove',
				'compose',
				'send',
				'importEml',
				'exportEml',
				'saveContact',
				'importVCards',
				'exportVCards',
				'saveEvent',
				'importIcs',
				'exportIcs',
			] as const)
				expect(typeof client[action], action).toBe('function');
			for (let i = 0; i < 200 && client.getState().status !== 'ready'; i++)
				await new Promise((done) => setTimeout(done, 5));
			const state = client.getState();
			expect(state.status).toBe('ready');
			expect(state.mailboxes.map((m) => m.role)).toContain('inbox');
			expect(state.contacts.length).toBeGreaterThan(0);
			expect(state.events.length).toBeGreaterThan(0);
		} finally {
			client.destroy();
		}
	});
});
