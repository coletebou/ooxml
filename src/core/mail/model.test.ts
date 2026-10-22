import { writtenAs, type Identity } from './model';

const identity = (id: string, name: string, email: string, replyTo: string[] = []): Identity => ({
	id,
	name,
	email,
	replyTo: replyTo.map((address) => ({ name: '', email: address })),
	bcc: [],
	textSignature: '',
	htmlSignature: '',
});

describe('writtenAs', () => {
	const own = identity('own', 'Sam', 'sam@example.com');
	const support = identity('support', 'Support', 'sam@example.com', ['help@example.com']);
	const sales = identity('sales', 'Sales', '*@example.net');
	const all = [own, support, sales];

	it('tells identities of one address apart by the name and Reply-To a save wrote', () => {
		const help = [{ name: '', email: 'help@example.com' }];
		const from = (name: string) => [{ name, email: 'SAM@example.com' }];
		expect(writtenAs(all, { from: from('Support'), replyTo: help })?.id).toBe('support');
		expect(writtenAs(all, { from: from('Sam'), replyTo: [] })?.id).toBe('own');
		// The name weighs more than the Reply-To, which decides alone when no name matches.
		expect(writtenAs(all, { from: from('Support'), replyTo: [] })?.id).toBe('support');
		expect(writtenAs(all, { from: from('Someone'), replyTo: help })?.id).toBe('support');
		// Neither matches: the first identity of the address.
		const other = [{ name: '', email: 'other@example.com' }];
		expect(writtenAs(all, { from: from('Someone'), replyTo: other })?.id).toBe('own');
		expect(writtenAs([support, own], { from: from('Someone'), replyTo: other })?.id).toBe(
			'support',
		);
	});

	it('takes an identity that covers the address, and none without a From', () => {
		expect(
			writtenAs(all, { from: [{ name: 'Lee', email: 'lee@example.net' }], replyTo: [] })?.id,
		).toBe('sales');
		expect(writtenAs(all, { from: [], replyTo: [] })).toBeUndefined();
	});
});
