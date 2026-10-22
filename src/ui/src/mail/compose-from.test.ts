// @vitest-environment jsdom
import type { ComposeState, Draft, Identity, MailAddress } from 'ooxml-core/mail';
import { defineMailCompose, type MailCompose } from './compose';

beforeAll(() => defineMailCompose());
afterEach(() => document.body.replaceChildren());

const identity = (id: string, name: string, email: string): Identity => ({
	id,
	name,
	email,
	replyTo: [],
	bcc: [],
	textSignature: '',
	htmlSignature: '',
});
/** One address, any address of a domain (named, and not), and one of another domain. */
const IDENTITIES = [
	identity('own', 'Ada', 'ada@example.com'),
	identity('team', 'Example Team', '*@example.com'),
	identity('any', '', '*@example.org'),
	identity('other', 'Ben', 'ben@other.test'),
];

const composeState = (draft: Partial<Draft>): ComposeState => ({
	session: 1,
	mode: 'new',
	draft: { to: [], cc: [], bcc: [], subject: '', text: '', attachments: [], ...draft },
	status: 'editing',
	savedAt: null,
	error: null,
	uploading: 0,
});

async function mount(draft: Partial<Draft>, locale = ''): Promise<MailCompose> {
	const el = document.createElement('mail-compose') as MailCompose;
	if (locale) el.locale = locale;
	el.identities = IDENTITIES;
	el.compose = composeState(draft);
	document.body.append(el);
	await el.updateComplete;
	return el;
}

const select = (el: MailCompose) => el.shadowRoot!.querySelector('select')!;
const labels = (el: MailCompose) => [...select(el).options].map((option) => option.textContent);

/** Pick identity `id` in the From field: the draft change it makes. */
function pick(el: MailCompose, id: string): Partial<Draft> {
	let patch: Partial<Draft> | undefined;
	el.addEventListener(
		'mail-draft-change',
		(e) => (patch = (e as CustomEvent<{ patch: Partial<Draft> }>).detail.patch),
		{ once: true },
	);
	select(el).value = id;
	select(el).dispatchEvent(new Event('change'));
	return patch!;
}

const ada: MailAddress = { name: 'Ada', email: 'ada@example.com' };

describe('<mail-compose> From', () => {
	it('picks an identity of any address of a domain without writing its wildcard', async () => {
		// The draft is written from an address of that domain: it stays, under the identity's name.
		const covered = await mount({ identityId: 'own', from: ada });
		expect(pick(covered, 'team')).toEqual({
			identityId: 'team',
			from: { name: 'Example Team', email: 'ada@example.com' },
		});
		// Written from another domain, or from a wildcard: the From is left to the server.
		for (const from of [
			{ name: 'Ben', email: 'ben@other.test' },
			{ name: 'Example Team', email: '*@example.com' },
		]) {
			const el = await mount({ identityId: 'other', from });
			const patch = pick(el, 'team');
			expect(patch.identityId).toBe('team');
			expect('from' in patch && patch.from === undefined).toBe(true);
			el.remove();
		}
		const unset = await mount({ identityId: 'own' });
		const patch = pick(unset, 'any');
		expect(patch.identityId).toBe('any');
		expect('from' in patch && patch.from === undefined).toBe(true);
		// An identity with an address of its own writes from it, as before.
		expect(pick(unset, 'other')).toEqual({
			identityId: 'other',
			from: { name: 'Ben', email: 'ben@other.test' },
		});
	});

	it('names an identity of any address of a domain by its domain, or by the address it writes from', async () => {
		const el = await mount({ identityId: 'own', from: ada });
		expect(labels(el)).toEqual([
			'Ada <ada@example.com>',
			'Example Team (any address at example.com)',
			'Any address at example.org',
			'Ben <ben@other.test>',
		]);
		el.compose = composeState({ identityId: 'team', from: ada });
		await el.updateComplete;
		expect(labels(el)[1]).toBe('Example Team <ada@example.com>');
		el.compose = composeState({ identityId: 'team' });
		await el.updateComplete;
		expect(labels(el)[1]).toBe('Example Team (any address at example.com)');
		const german = await mount({ identityId: 'own', from: ada }, 'de');
		expect(labels(german).slice(1, 3)).toEqual([
			'Example Team (jede Adresse der Domain example.com)',
			'Jede Adresse der Domain example.org',
		]);
	});
});
