import submission from './__fixtures__/rfc8621-submission.json';
import type { Draft } from '../model';
import { objects, toIdentity } from './convert';
import { emailToCreate, identityCovers, pickIdentity } from './outgoing';

const identities = objects((submission.identityResponse[1] as { list: unknown }).list).map(
	toIdentity,
);
const [joe, wildcard] = identities as [(typeof identities)[0], (typeof identities)[0]];
const draft: Draft = { to: [], cc: [], bcc: [], subject: '', text: '', attachments: [] };

describe('pickIdentity', () => {
	it('takes the named identity, else one covering the sender, else the first', () => {
		expect(pickIdentity(identities, { ...draft, identityId: 'XD-9911312-11_22AAz' })).toBe(
			wildcard,
		);
		expect(
			pickIdentity(identities, { ...draft, from: { name: '', email: 'Sales@Example.com' } }),
		).toBe(wildcard);
		expect(
			pickIdentity(identities, { ...draft, from: { name: '', email: 'JOE@example.com' } }),
		).toBe(joe);
		expect(pickIdentity(identities, { ...draft, identityId: 'gone' })).toBe(joe);
		expect(pickIdentity([], draft)).toBeUndefined();
	});

	it('reads `*@domain` as every address of that domain (RFC 8621 6)', () => {
		expect(identityCovers(wildcard, 'anyone@example.com')).toBe(true);
		expect(identityCovers(wildcard, 'anyone@example.com.evil')).toBe(false);
		expect(identityCovers(joe, 'joe@example.com')).toBe(true);
		expect(identityCovers(joe, 'jo@example.com')).toBe(false);
	});
});

describe('emailToCreate', () => {
	it('writes as the identity, never as a wildcard address, and leaves empty parts out', () => {
		const plain = emailToCreate({ ...draft, text: 'Hi', html: '' }, 'D', ['$draft'], wildcard);
		expect(JSON.parse(JSON.stringify(plain))).toEqual({
			mailboxIds: { D: true },
			keywords: { $draft: true },
			subject: '',
			bodyValues: { text: { value: 'Hi' } },
			textBody: [{ partId: 'text', type: 'text/plain' }],
		});
		const signed = emailToCreate(draft, 'D', [], {
			...joe,
			replyTo: [{ name: '', email: 'desk@example.com' }],
		});
		expect(signed.from).toEqual([{ name: 'Joe Bloggs', email: 'joe@example.com' }]);
		expect(signed.replyTo).toEqual([{ name: null, email: 'desk@example.com' }]);
		expect(emailToCreate(draft, 'D', [], undefined).from).toBeUndefined();
	});
});
