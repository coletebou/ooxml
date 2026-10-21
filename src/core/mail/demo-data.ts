// The words of the demo mailbox: fictional people at reserved example domains (RFC 2606) and the
// conversations they have. Data only; `demo-seed.ts` turns it into messages. New code.
import type { MailAddress } from './model';

export const DEMO_ME: MailAddress = { name: 'Sam Rivera', email: 'sam@example.com' };

export const DEMO_PEOPLE: readonly (MailAddress & { org: string; title: string; phone: string })[] =
	[
		{
			name: 'Amara Okafor',
			email: 'amara@example.org',
			org: 'Northwind Labs',
			title: 'Product lead',
			phone: '+1 555 0101',
		},
		{
			name: 'Ben Carter',
			email: 'ben.carter@example.net',
			org: 'Carter & Sons',
			title: 'Accountant',
			phone: '+1 555 0102',
		},
		{
			name: 'Chen Wei',
			email: 'chen.wei@example.org',
			org: 'Northwind Labs',
			title: 'Engineer',
			phone: '+1 555 0103',
		},
		{
			name: 'Diego Alvarez',
			email: 'diego@example.net',
			org: 'Alvarez Design',
			title: 'Designer',
			phone: '+1 555 0104',
		},
		{
			name: 'Elena Rossi',
			email: 'elena.rossi@example.com',
			org: 'Example Travel',
			title: 'Travel agent',
			phone: '+1 555 0105',
		},
		{
			name: 'Farah Haddad',
			email: 'farah@example.org',
			org: 'Northwind Labs',
			title: 'Researcher',
			phone: '+1 555 0106',
		},
		{
			name: 'Gustav Lind',
			email: 'gustav.lind@example.net',
			org: 'Lind Consulting',
			title: 'Consultant',
			phone: '+1 555 0107',
		},
		{
			name: 'Hana Sato',
			email: 'hana@example.com',
			org: 'Example Books',
			title: 'Editor',
			phone: '+1 555 0108',
		},
		{
			name: 'Isaac Mensah',
			email: 'isaac@example.org',
			org: 'Northwind Labs',
			title: 'Operations',
			phone: '+1 555 0109',
		},
		{
			name: 'Julia Novak',
			email: 'julia.novak@example.net',
			org: 'Novak Legal',
			title: 'Lawyer',
			phone: '+1 555 0110',
		},
	];

/** A conversation template: who starts it, the subject, the opening text and the replies. */
export interface DemoThread {
	from: number;
	subject: string;
	text: string;
	replies: readonly { from: number | 'me'; text: string }[];
	attach?: 'docx' | 'xlsx' | 'pptx' | 'vsdx' | 'text';
}

export const DEMO_THREADS: readonly DemoThread[] = [
	{
		from: 0,
		subject: 'Q3 roadmap review',
		text: 'Hi Sam,\n\nAttached is the draft roadmap for next quarter. Could you look at the milestones before Thursday?\n\nThanks,\nAmara',
		replies: [
			{
				from: 'me',
				text: 'Looks good overall. The beta date feels tight; can we add a week of buffer?',
			},
			{ from: 0, text: 'Fair point. I moved the beta by a week and updated the slides.' },
			{ from: 2, text: 'A week works for engineering too. I will update the tickets.' },
		],
		attach: 'pptx',
	},
	{
		from: 1,
		subject: 'Invoice 2026-118',
		text: 'Hello,\n\nPlease find the invoice for September attached. Payment is due within 30 days.\n\nKind regards,\nBen Carter',
		replies: [{ from: 'me', text: 'Thanks Ben, it is with finance now.' }],
		attach: 'xlsx',
	},
	{
		from: 3,
		subject: 'New logo concepts',
		text: 'Three directions for the new logo are in the deck. My favourite is the second one, but I am curious what you think.',
		replies: [
			{ from: 'me', text: 'The second one for me as well. Could we try it in a darker blue?' },
			{ from: 3, text: 'Sure, darker blue version coming tomorrow.' },
		],
	},
	{
		from: 4,
		subject: 'Your trip to Lisbon',
		text: 'Dear Sam,\n\nYour itinerary is confirmed: flight on the 12th, hotel for three nights near the river. The details are in the attached document.\n\nSafe travels,\nElena',
		replies: [],
		attach: 'docx',
	},
	{
		from: 5,
		subject: 'Interview notes',
		text: 'I wrote up the notes from the five customer interviews. The main theme: people want offline access.',
		replies: [
			{ from: 0, text: 'Great work Farah. Offline access goes on the list for the review.' },
		],
		attach: 'text',
	},
	{
		from: 6,
		subject: 'Process map for onboarding',
		text: 'As discussed, here is the onboarding process as a diagram. The red boxes are where new people get stuck.',
		replies: [],
		attach: 'vsdx',
	},
	{
		from: 7,
		subject: 'Chapter 4 edits',
		text: 'I went through chapter 4. Mostly small things, but the ending needs another pass.',
		replies: [
			{ from: 'me', text: 'Thanks Hana. I will rework the ending this weekend.' },
			{ from: 7, text: 'No rush. Next Friday is fine.' },
		],
	},
	{
		from: 8,
		subject: 'Office closed on Monday',
		text: 'A reminder that the office is closed on Monday for maintenance. Remote work as usual.',
		replies: [],
	},
	{
		from: 9,
		subject: 'Contract renewal',
		text: 'The renewal terms are ready for your review. Let me know a good time for a call this week.',
		replies: [{ from: 'me', text: 'Wednesday afternoon works. 3 pm?' }],
	},
	{
		from: 2,
		subject: 'Build is green again',
		text: 'The flaky test is fixed and main is green. Thanks for the patience.',
		replies: [],
	},
];

export const DEMO_TOPICS: readonly string[] = [
	'Weekly sync',
	'Budget question',
	'Lunch on Friday?',
	'Draft for review',
	'Quick favour',
	'Conference tickets',
	'Team offsite ideas',
	'Status update',
	'Feedback on the proposal',
	'Holiday schedule',
];

export const DEMO_LINES: readonly string[] = [
	'Could you take a look when you have a moment?',
	'Thanks for the quick reply.',
	'I have added my comments below.',
	'Let us discuss this at the next meeting.',
	'Sounds good to me.',
	'I will send the details tomorrow.',
	'Please see the notes from yesterday.',
	'Happy to help with this.',
];
