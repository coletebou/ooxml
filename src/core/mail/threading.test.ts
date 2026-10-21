import { summary } from './test-support/emails';
import { threadConversations } from './threading';

const ids = (conversation: { entries: readonly { email: { id: string }; depth: number }[] }) =>
	conversation.entries.map((entry) => `${entry.email.id}@${entry.depth}`);

describe('threadConversations (RFC 5256 REFERENCES)', () => {
	it('links replies by References and orders siblings by date', () => {
		const list = threadConversations([
			summary('c', { references: ['a@example.test'], minute: 3, subject: 'Re: Plan' }),
			summary('a', { minute: 1, subject: 'Plan' }),
			summary('b', { references: ['a@example.test'], minute: 2, subject: 'Re: Plan' }),
			summary('d', {
				references: ['a@example.test', 'b@example.test'],
				minute: 4,
				subject: 'Re: Plan',
			}),
		]);
		expect(list).toHaveLength(1);
		expect(ids(list[0]!)).toEqual(['a@0', 'b@1', 'd@2', 'c@1']);
		expect(list[0]!.id).toBe('a');
		expect(list[0]!.latest.id).toBe('d');
	});

	it('falls back to the first In-Reply-To id without References', () => {
		const list = threadConversations([
			summary('a', { minute: 1 }),
			summary('b', { inReplyTo: ['a@example.test'], minute: 2, subject: 'unrelated' }),
		]);
		expect(list).toHaveLength(1);
		expect(ids(list[0]!)).toEqual(['a@0', 'b@1']);
	});

	it('keeps siblings whose parent is missing together under no visible placeholder', () => {
		const list = threadConversations([
			summary('b', { references: ['gone@example.test'], minute: 2, subject: 'Re: Gone' }),
			summary('c', { references: ['gone@example.test'], minute: 3, subject: 'Re: Gone' }),
		]);
		expect(list).toHaveLength(1);
		expect(ids(list[0]!)).toEqual(['b@0', 'c@0']);
	});

	it('promotes the only child of a missing root', () => {
		const list = threadConversations([
			summary('b', { references: ['gone@example.test'], minute: 2, subject: 'Re: Gone' }),
		]);
		expect(ids(list[0]!)).toEqual(['b@0']);
	});

	it('groups by base subject when references were lost, the reply under the original', () => {
		const list = threadConversations([
			summary('a', { minute: 1, subject: 'Budget' }),
			summary('b', { messageId: 'b@example.test', minute: 2, subject: 'Re: Budget' }),
			summary('x', { minute: 3, subject: 'Something else' }),
		]);
		expect(list.map(ids)).toEqual([['x@0'], ['a@0', 'b@1']]);
	});

	it('makes two originals with one subject siblings, not parent and child', () => {
		const list = threadConversations([
			summary('a', { minute: 1, subject: 'Weekly' }),
			summary('b', { minute: 2, subject: 'Weekly' }),
			summary('c', { minute: 3, subject: 'Re: Weekly' }),
		]);
		expect(list).toHaveLength(1);
		expect(ids(list[0]!)).toEqual(['a@0', 'b@0', 'c@0']);
	});

	it('can skip subject grouping and threading altogether', () => {
		const emails = [
			summary('a', { subject: 'Same' }),
			summary('b', { subject: 'Same', minute: 1 }),
		];
		expect(threadConversations(emails, { bySubject: false })).toHaveLength(2);
		const flat = threadConversations(
			[summary('a'), summary('b', { references: ['a@example.test'], minute: 1 })],
			{ byReferences: false },
		);
		expect(flat.map((c) => c.id)).toEqual(['b', 'a']);
	});

	it('survives reference loops and duplicate message ids', () => {
		const list = threadConversations([
			summary('a', { references: ['b@example.test'], minute: 1, subject: 'Loop' }),
			summary('b', { references: ['a@example.test'], minute: 2, subject: 'Loop' }),
			summary('c', { messageId: 'a@example.test', minute: 3, subject: 'Dup' }),
		]);
		const all = list.flatMap((c) => c.entries.map((entry) => entry.email.id)).sort();
		expect(all).toEqual(['a', 'b', 'c']);
	});

	it('compares message ids case-sensitively, once their quoting is removed (RFC 5256 3)', () => {
		const list = threadConversations(
			[
				summary('a', { messageId: 'Root.A@example.test', minute: 1 }),
				summary('b', { references: ['root.a@example.test'], minute: 2 }),
				summary('c', { messageId: '"Quoted.C"@example.test', minute: 3 }),
				summary('d', { references: ['Quoted.C@example.test'], minute: 4 }),
			],
			{ bySubject: false },
		);
		expect(list.map(ids)).toEqual([['c@0', 'd@1'], ['b@0'], ['a@0']]);
	});

	it('links a References header of a hundred thousand ids without walking back each time', () => {
		const references = Array.from({ length: 100_000 }, (_, i) => `r${i}@example.test`);
		const started = performance.now();
		const [only, ...others] = threadConversations([summary('m', { references })]);
		const elapsed = performance.now() - started;
		expect(others).toEqual([]);
		expect(ids(only!)).toEqual(['m@0']);
		// Each new id used to walk back through every id before it, five billion steps and many
		// seconds; now it is milliseconds. Generous, so a loaded runner does not flake.
		expect(elapsed).toBeLessThan(2000);
	});

	it('walks a long References chain once however often the header repeats its ends', () => {
		const n = 60_000;
		const chain = Array.from({ length: n }, (_, i) => `r${i}@example.test`);
		// Each repeated first id would close a loop under the last, and stays without a parent; each
		// other id at the bottom of the chain is checked again from as deep.
		const repeats = Array.from({ length: n }, (_, i) => [chain[0]!, chain[n - 1 - (i % 100)]!]);
		const started = performance.now();
		const [only, ...others] = threadConversations([
			summary('m', { references: [...chain, ...repeats.flat()] }),
		]);
		const elapsed = performance.now() - started;
		expect(others).toEqual([]);
		expect(ids(only!)).toEqual(['m@0']);
		// Each repeat used to walk the whole chain again: 3.6 billion steps. Generous, so a loaded
		// runner does not flake.
		expect(elapsed).toBeLessThan(2000);
	});

	it('links repeated ids where the algorithm does, and refuses the loops', () => {
		const list = threadConversations([
			summary('a', { minute: 1, subject: 'Loop' }),
			summary('b', { references: ['a@example.test'], minute: 2, subject: 'Re: Loop' }),
			// Under b, then a again, which would close a loop: the message stays under a, its last id.
			summary('c', {
				references: ['b@example.test', 'a@example.test', 'b@example.test', 'a@example.test'],
				minute: 3,
				subject: 'Re: Loop',
			}),
			// x and a placeholder p under it, then both again: x would close a loop under p.
			summary('d', {
				references: ['x@example.test', 'p@example.test', 'x@example.test', 'p@example.test'],
				minute: 4,
				subject: 'Other',
			}),
		]);
		expect(list.map(ids)).toEqual([['d@0'], ['a@0', 'b@1', 'c@1']]);
	});

	it('still refuses a reference loop through messages already linked', () => {
		const list = threadConversations([
			summary('a', { minute: 1, subject: 'Loop' }),
			summary('b', { references: ['a@example.test'], minute: 2, subject: 'Re: Loop' }),
			summary('c', { references: ['b@example.test'], minute: 3, subject: 'Re: Loop' }),
			// Claims to be above its own ancestors: linking it there would close a loop.
			summary('d', {
				references: ['c@example.test', 'a@example.test'],
				minute: 4,
				subject: 'Re: Loop',
			}),
		]);
		expect(list.map(ids)).toEqual([['a@0', 'b@1', 'c@2', 'd@1']]);
	});

	it('ignores messages without a subject when grouping', () => {
		const list = threadConversations([
			summary('a', { subject: '' }),
			summary('b', { subject: '', minute: 1 }),
		]);
		expect(list).toHaveLength(2);
	});

	it('handles a reply chain thousands deep without recursion', () => {
		const emails = Array.from({ length: 6000 }, (_, i) =>
			summary(`m${i}`, {
				minute: i,
				subject: i ? 'Re: Chain' : 'Chain',
				inReplyTo: i ? [`m${i - 1}@example.test`] : [],
			}),
		);
		const [only] = threadConversations(emails);
		expect(only!.entries).toHaveLength(6000);
		expect(only!.entries.at(-1)!.depth).toBe(5999);
	});

	it('threads ten thousand messages quickly', () => {
		const emails = Array.from({ length: 10_000 }, (_, i) => {
			const root = Math.floor(i / 5) * 5;
			return summary(`m${i}`, {
				minute: i,
				subject: i === root ? `Topic ${root}` : `Re: Topic ${root}`,
				references: i === root ? [] : [`m${root}@example.test`],
			});
		});
		const started = performance.now();
		const list = threadConversations(emails);
		const elapsed = performance.now() - started;
		expect(list).toHaveLength(2000);
		expect(list[0]!.entries).toHaveLength(5);
		// Generous: a loaded CI runner must not flake; the point is "not quadratic".
		expect(elapsed).toBeLessThan(3000);
	});
});
