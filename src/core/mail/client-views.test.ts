import { conversationView } from './client-views';
import { summary } from './test-support/emails';
import { threadConversations } from './threading';

describe('conversationView', () => {
	it('names the newest message, which reading order does not end with', () => {
		// Depth first: a, its reply b with b's reply d, then a's reply c, written before d.
		const [conversation] = threadConversations([
			summary('a', { minute: 1, subject: 'Plan' }),
			summary('b', { references: ['a@example.test'], minute: 2, subject: 'Re: Plan' }),
			summary('c', { references: ['a@example.test'], minute: 3, subject: 'Re: Plan' }),
			summary('d', {
				references: ['a@example.test', 'b@example.test'],
				minute: 4,
				subject: 'Re: Plan',
			}),
		]);
		const view = conversationView(conversation!);
		expect(view.emailIds).toEqual(['a', 'b', 'd', 'c']);
		expect(view.latestId).toBe('d');
	});
});
