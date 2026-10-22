// The demo mailbox: conversations with replies, unread and flagged mail, Office attachments (when
// the host supplies the files), an HTML newsletter with remote images and a script (to show the
// sanitiser at work), an inline `cid:` image, a draft, junk, an address book and a week of
// calendar events, all relative to `now` and the same on every run (a seeded generator). `bulk`
// adds thousands of older messages to try the list at scale. New code.
import type { CalendarEvent } from '../calendar/model';
import { addDays, startOfDay, zonedParts, zonedToUtc } from '../calendar/time-zone';
import { emptyContact, type Contact } from './contacts';
import {
	DEMO_LINES,
	DEMO_ME,
	DEMO_PEOPLE,
	DEMO_THREADS,
	DEMO_TOPICS,
	type DemoThread,
} from './demo-data';
import { DEFAULT_MAILBOXES, type SeedMessage } from './memory-messages';
import type { MemoryTransportOptions } from './memory-transport';
import { DRAFT, type MailAddress } from './model';
import type { OutgoingAttachment } from './mime';
import { replySubject } from './subject';

export type DemoFileKind = 'docx' | 'xlsx' | 'pptx' | 'vsdx';

export interface DemoSeedOptions {
	now?: number;
	/** The zone calendar events are placed in. Default UTC. */
	zone?: string;
	/** Older messages to add to the Inbox, to try the list with thousands. */
	bulk?: number;
	/** Office files for the messages that carry one; a kind not given is simply left out. */
	files?: Partial<Record<DemoFileKind, Uint8Array>>;
}

export interface DemoSeed extends MemoryTransportOptions {
	contacts: Contact[];
	events: CalendarEvent[];
}

const HOUR = 3_600_000;
const MIME: Record<DemoFileKind, string> = {
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	vsdx: 'application/vnd.ms-visio.drawing',
};
const NAMES: Record<DemoFileKind | 'text', string> = {
	docx: 'Itinerary.docx',
	xlsx: 'Invoice 2026-118.xlsx',
	pptx: 'Q3 roadmap.pptx',
	vsdx: 'Onboarding process.vsdx',
	text: 'Interview notes.txt',
};
/** The inline logo of the welcome message, an SVG wordmark (an image, so it runs no script). */
const LOGO = new TextEncoder().encode(
	'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24" viewBox="0 0 96 24"><rect width="96" height="24" rx="4" fill="#1f6feb"/><text x="48" y="16" font-family="sans-serif" font-size="12" fill="#fff" text-anchor="middle">Northwind</text></svg>',
);

/** mulberry32: a small seeded generator, so the demo is the same on every run. */
function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const person = (index: number): MailAddress => {
	const p = DEMO_PEOPLE[index % DEMO_PEOPLE.length]!;
	return { name: p.name, email: p.email };
};

function attachment(
	kind: DemoThread['attach'],
	files: DemoSeedOptions['files'],
): OutgoingAttachment[] {
	if (!kind) return [];
	if (kind === 'text') {
		const text =
			'Interview notes\n\n1. Offline access matters most.\n2. Search must be fast.\n3. Sharing is a must.\n';
		return [{ name: NAMES.text, type: 'text/plain', bytes: new TextEncoder().encode(text) }];
	}
	const bytes = files?.[kind];
	return bytes ? [{ name: NAMES[kind], type: MIME[kind], bytes }] : [];
}

const REPLY_GAP = 40 * 60_000;

function threads(now: number, files: DemoSeedOptions['files']): SeedMessage[] {
	const out: SeedMessage[] = [];
	DEMO_THREADS.forEach((thread, t) => {
		// The last message of thread `t` arrived 7t + 1 hours ago, so no reply is dated in the future.
		const start = now - (t * 7 + 1) * HOUR - thread.replies.length * REPLY_GAP;
		const rootId = `demo-${t}-0`;
		const root = `${rootId}@demo.example.com`;
		const ids = [root];
		// Thread 9 is filed in Projects, a folder the person made.
		const folder = t === 9 ? 'projects' : 'inbox';
		out.push({
			id: rootId,
			mailboxId: folder,
			from: person(thread.from),
			to: [DEMO_ME],
			subject: thread.subject,
			text: thread.text,
			attachments: attachment(thread.attach, files),
			messageId: root,
			receivedAt: start,
			unread: t < 4 && thread.replies.length === 0,
			flagged: t === 1,
		});
		thread.replies.forEach((reply, r) => {
			const id = `demo-${t}-${r + 1}`;
			const messageId = `${id}@demo.example.com`;
			const mine = reply.from === 'me';
			const last = r === thread.replies.length - 1;
			out.push({
				id,
				mailboxId: mine ? 'sent' : folder,
				from: mine ? DEMO_ME : person(reply.from as number),
				to: mine ? [person(thread.from)] : [DEMO_ME],
				subject: replySubject(thread.subject),
				text: reply.text,
				messageId,
				inReplyTo: [ids.at(-1)!],
				references: [...ids],
				receivedAt: start + (r + 1) * REPLY_GAP,
				unread: !mine && last && t < 3,
			});
			ids.push(messageId);
		});
	});
	return out;
}

function extras(now: number): SeedMessage[] {
	const logo = {
		name: 'logo.svg',
		type: 'image/svg+xml',
		bytes: LOGO,
		cid: 'logo@northwind',
		inline: true,
	};
	return [
		{
			id: 'demo-news',
			mailboxId: 'inbox',
			from: { name: 'Example Weekly', email: 'news@example.com' },
			to: [DEMO_ME],
			subject: 'This week: offline-first apps',
			html: '<html><head><style>h1{color:#0b57d0} .card{padding:12px;border:1px solid #ddd}</style></head><body><h1>Example Weekly</h1><img src="https://images.example.com/banner.png" alt="Banner" width="600"><div class="card"><p>Offline-first apps keep working without a connection.</p><p><a href="https://www.example.com/read">Read the article</a></p></div><script>document.title = "tracked"</script><img src="https://tracker.example.com/open.gif" width="1" height="1" alt=""></body></html>',
			text: 'Example Weekly\n\nOffline-first apps keep working without a connection.\nRead the article: https://www.example.com/read',
			receivedAt: now - 30 * 60_000,
			unread: true,
		},
		{
			id: 'demo-welcome',
			mailboxId: 'inbox',
			from: person(0),
			to: [DEMO_ME],
			cc: [person(2), person(5)],
			subject: 'Welcome to the team space',
			html: '<p>Hi everyone,</p><p>Welcome! The <b>team space</b> is ready. Our logo is below.</p><p><img src="cid:logo@northwind" width="96" height="24" alt="Northwind logo"></p><p>Write to <a href="mailto:amara@example.org">amara@example.org</a> with questions.</p>',
			attachments: [logo],
			receivedAt: now - 3 * 24 * HOUR,
		},
		{
			id: 'demo-draft',
			mailboxId: 'drafts',
			from: DEMO_ME,
			to: [person(9)],
			subject: replySubject('Contract renewal'),
			text: 'Hi Julia,\n\nI read the terms and have two questions:\n',
			receivedAt: now - 2 * HOUR,
			keywords: [DRAFT],
		},
		{
			id: 'demo-junk',
			mailboxId: 'junk',
			from: { name: 'Prize Desk', email: 'prize@example.net' },
			to: [DEMO_ME],
			subject: 'You have won a prize!!!',
			text: 'Click here to claim your prize. (This is a demo junk message.)',
			receivedAt: now - 5 * HOUR,
			unread: true,
		},
		{
			id: 'demo-trash',
			mailboxId: 'trash',
			from: { name: 'Example Weekly', email: 'news@example.com' },
			to: [DEMO_ME],
			subject: 'Last week: shortcuts you should know',
			text: 'An older newsletter.',
			receivedAt: now - 8 * 24 * HOUR,
		},
		...[0, 1, 2, 3].map((i) => ({
			id: `demo-archive-${i}`,
			mailboxId: 'archive',
			from: person(i + 3),
			to: [DEMO_ME],
			subject: DEMO_TOPICS[i]!,
			text: DEMO_LINES[i]!,
			receivedAt: now - (14 + i * 3) * 24 * HOUR,
		})),
	];
}

function bulk(count: number, now: number): SeedMessage[] {
	const next = random(20_261_020);
	const out: SeedMessage[] = [];
	for (let i = 0; i < count;) {
		const size = 1 + Math.floor(next() * 4);
		const subject = `${DEMO_TOPICS[Math.floor(next() * DEMO_TOPICS.length)]!} #${i + 1}`;
		const start = now - (2 + i) * 6 * HOUR;
		const ids: string[] = [];
		for (let r = 0; r < size && i < count; r++, i++) {
			const id = `bulk-${i}`;
			out.push({
				id,
				mailboxId: 'inbox',
				from: person(Math.floor(next() * DEMO_PEOPLE.length)),
				to: [DEMO_ME],
				subject: r ? replySubject(subject) : subject,
				text: DEMO_LINES[Math.floor(next() * DEMO_LINES.length)]!,
				messageId: `${id}@bulk.example.com`,
				...(r ? { inReplyTo: [ids.at(-1)!], references: [...ids] } : {}),
				receivedAt: start + r * 20 * 60_000,
				unread: next() < 0.1,
				flagged: next() < 0.03,
			});
			ids.push(`${id}@bulk.example.com`);
		}
	}
	return out;
}

function contacts(now: number): Contact[] {
	return DEMO_PEOPLE.map((p, i) => {
		const [givenName = '', ...family] = p.name.split(' ');
		return {
			...emptyContact(`demo-contact-${i}`, now),
			name: p.name,
			givenName,
			familyName: family.join(' '),
			emails: [{ type: 'work', address: p.email }],
			phones: [{ type: 'work', number: p.phone }],
			organization: p.org,
			title: p.title,
		};
	});
}

function events(now: number, zone: string): CalendarEvent[] {
	const today = startOfDay(now, zone);
	const at = (dayOffset: number, hour: number, minute = 0): number => {
		const day = zonedParts(addDays(today, dayOffset, zone), zone);
		return zonedToUtc({ year: day.year, month: day.month, day: day.day, hour, minute }, zone);
	};
	const base = { description: '', zone, repeat: 'none' as const };
	return [
		{
			...base,
			id: 'demo-standup',
			title: 'Stand-up',
			start: at(0, 9, 30),
			end: at(0, 9, 45),
			repeat: 'weekly',
		},
		{
			...base,
			id: 'demo-roadmap',
			title: 'Roadmap review',
			location: 'Room 3',
			start: at(0, 14),
			end: at(0, 15),
			attendees: [person(0), person(2)],
		},
		{
			...base,
			id: 'demo-trip',
			title: 'Lisbon trip',
			start: addDays(today, 2, zone),
			end: addDays(today, 5, zone),
			allDay: true,
		},
		{
			...base,
			id: 'demo-lunch',
			title: 'Lunch with Diego',
			start: at(1, 12, 30),
			end: at(1, 13, 30),
		},
		{
			...base,
			id: 'demo-contract',
			title: 'Contract call',
			description: 'Renewal terms with Julia.',
			start: at(7, 15),
			end: at(7, 15, 45),
			attendees: [person(9)],
		},
	];
}

/** The demo mailbox for `createMemoryTransport`, with its address book and calendar. */
export function createDemoSeed(options: DemoSeedOptions = {}): DemoSeed {
	const now = options.now ?? Date.now();
	const zone = options.zone ?? 'UTC';
	return {
		account: { id: 'demo', name: DEMO_ME.email },
		identities: [
			{
				id: 'demo-me',
				name: DEMO_ME.name,
				email: DEMO_ME.email,
				replyTo: [],
				bcc: [],
				textSignature: '',
				htmlSignature: '',
			},
		],
		mailboxes: [...DEFAULT_MAILBOXES, { id: 'projects', name: 'Projects', sortOrder: 20 }],
		messages: [
			...threads(now, options.files),
			...extras(now),
			...bulk(Math.max(0, options.bulk ?? 0), now),
		],
		contacts: contacts(now),
		events: events(now, zone),
	};
}
