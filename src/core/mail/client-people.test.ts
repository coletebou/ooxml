import type { CalendarEvent } from '../calendar/model';
import { createMemoryCalendarStore } from './calendar-store';
import { createMailClient } from './client';
import type { MailNotice } from './client-types';
import { createMemoryContactStore, emptyContact, type ContactStore } from './contacts';
import { createMemoryTransport } from './memory-transport';
import type { KeyValueStorage } from './record-store';
import { until } from './test-support/client';
import { MailTransportError } from './transport';

const STAND_UP: CalendarEvent = {
	id: 'stand-up',
	title: 'Stand-up',
	description: 'Ten minutes',
	zone: 'Europe/Berlin',
	start: Date.UTC(2026, 9, 21, 7),
	end: Date.UTC(2026, 9, 21, 7, 10),
	repeat: 'weekly',
	count: 4,
};

describe('the calendar actions', () => {
	it('recognises its own events when an exported calendar is imported again', async () => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			calendar: createMemoryCalendarStore({ seed: [STAND_UP] }),
		});
		await until(client, (s) => s.events.length === 1);
		const text = client.exportIcs();
		expect(text).toContain('UID:stand-up@');
		expect(await client.importIcs(text, 'Europe/Berlin')).toBe(1);
		expect(client.getState().events).toEqual([STAND_UP]);
		client.destroy();
	});

	it('keeps what an earlier import brought when another file without UIDs comes in', async () => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			calendar: createMemoryCalendarStore(),
		});
		const file = (title: string, ...lines: string[]): string =>
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'BEGIN:VEVENT',
				...lines,
				`SUMMARY:${title}`,
				'DTSTART:20261020T090000Z',
				'END:VEVENT',
				'END:VCALENDAR',
			].join('\r\n');
		const titles = () => client.getState().events.map((event) => event.title);
		expect(await client.importIcs(file('First'))).toBe(1);
		expect(await client.importIcs(file('Second'))).toBe(1);
		expect(titles()).toEqual(['First', 'Second']);
		// An event with a UID is still the same event when it comes in again.
		await client.importIcs(file('Review', 'UID:review@example.com'));
		await client.importIcs(file('Review, moved', 'UID:review@example.com'));
		expect(titles()).toEqual(['First', 'Second', 'Review, moved']);
		// One that took `event-2`, as `event` was in use, is still itself once `event` is deleted.
		await client.importIcs(file('Other', 'UID:event'));
		await client.deleteEvent('event');
		await client.importIcs(file('Other, moved', 'UID:event'));
		expect(titles()).toEqual(['Second', 'Review, moved', 'Other, moved']);
		client.destroy();
	});

	it('adds an occurrence changed on its own to the series it holds, never replacing the series', async () => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			calendar: createMemoryCalendarStore({ seed: [STAND_UP] }),
		});
		await until(client, (s) => s.events.length === 1);
		const file = (uid: string, ...lines: string[]): string =>
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'BEGIN:VEVENT',
				`UID:${uid}`,
				'SUMMARY:Review',
				...lines,
				'END:VEVENT',
				'END:VCALENDAR',
			].join('\r\n');
		const week = (n: number): number => Date.UTC(2026, 9, 20 + 7 * n, 9);
		expect(
			await client.importIcs(
				file('review@example.com', 'DTSTART:20261020T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=4'),
			),
		).toBe(1);
		// The way an update to one occurrence comes: that occurrence alone, moved or cancelled.
		const moved = ['RECURRENCE-ID:20261027T090000Z', 'DTSTART:20261028T140000Z'];
		expect(await client.importIcs(file('review@example.com', 'SEQUENCE:1', ...moved))).toBe(1);
		const cancelled = ['RECURRENCE-ID:20261103T090000Z', 'DTSTART:20261103T090000Z'];
		await client.importIcs(file('review@example.com', ...cancelled, 'STATUS:CANCELLED'));
		// Of an event this client exported, too (at 09:00 in Berlin, 08:00 UTC after the clocks change).
		const own = ['RECURRENCE-ID:20261028T080000Z', 'DTSTART:20261028T090000Z'];
		await client.importIcs(file('stand-up@ooxml-mail.invalid', ...own));
		const events = client.getState().events;
		expect(events.map((e) => [e.id, e.repeat])).toEqual([
			['review@example.com', 'weekly'],
			['stand-up', 'weekly'],
		]);
		expect(events[0]?.exceptions).toEqual([
			{
				originalStart: week(1),
				cancelled: false,
				start: Date.UTC(2026, 9, 28, 14),
				end: Date.UTC(2026, 9, 28, 14),
			},
			{ originalStart: week(2), cancelled: true },
		]);
		expect(events[1]?.exceptions).toEqual([
			{
				originalStart: Date.UTC(2026, 9, 28, 8),
				cancelled: false,
				start: Date.UTC(2026, 9, 28, 9),
				end: Date.UTC(2026, 9, 28, 9),
				title: 'Review',
				description: '',
			},
		]);
		// An occurrence of a series the calendar does not hold stands beside the others.
		await client.importIcs(file('other@example.com', ...moved));
		expect(client.getState().events.map((e) => e.id)).toEqual([
			'review@example.com',
			'stand-up',
			'other@example.com-20261027T090000Z',
		]);
		client.destroy();
	});

	it('never replaces a stored event with one from another program whose UID is its id', async () => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			calendar: createMemoryCalendarStore({ seed: [STAND_UP] }),
		});
		await until(client, (s) => s.events.length === 1);
		const file = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'BEGIN:VEVENT',
			'UID:stand-up',
			'SUMMARY:Another program',
			'DTSTART:20261020T090000Z',
			'END:VEVENT',
			'END:VCALENDAR',
		].join('\r\n');
		expect(await client.importIcs(file)).toBe(1);
		// The calendar's own event stays as it was; the other one stands beside it, its UID kept.
		const others = () => client.getState().events.filter((event) => event.id !== 'stand-up');
		expect(client.getState().events.find((event) => event.id === 'stand-up')).toEqual(STAND_UP);
		expect(others()).toMatchObject([{ title: 'Another program', uid: 'stand-up' }]);
		// Imported again, it is that same event, not a copy.
		expect(await client.importIcs(file)).toBe(1);
		expect(others()).toHaveLength(1);
		expect(client.getState().events).toHaveLength(2);
		client.destroy();
	});
});

describe('a change the storage does not take', () => {
	/** A storage that refuses every write, as a full one does. */
	const full: KeyValueStorage = {
		getItem: () => null,
		setItem: () => {
			throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
		},
	};
	const card = (name: string): string =>
		`BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${name}\r\nFN:${name}\r\nEND:VCARD\r\n`;
	const event = (uid: string, start: string): string[] => [
		'BEGIN:VEVENT',
		`UID:${uid}`,
		`SUMMARY:${uid}`,
		`DTSTART:${start}`,
		'END:VEVENT',
	];
	const setup = (contacts: ContactStore) => {
		const client = createMailClient({
			transport: createMemoryTransport(),
			contacts,
			calendar: createMemoryCalendarStore({ storage: full }),
		});
		const notices: MailNotice[] = [];
		client.onNotice((notice) => notices.push(notice));
		const errors = () => notices.filter((notice) => notice.kind === 'error');
		return { client, notices, errors };
	};

	it('is kept for the session and listed, and reported as not stored', async () => {
		const { client, errors } = setup(createMemoryContactStore({ storage: full }));
		await until(client, (s) => s.status === 'ready');
		const names = () => client.getState().contacts.map((contact) => contact.name);
		await client.saveContact({ ...emptyContact('ada', 0), name: 'Ada' });
		expect(names()).toEqual(['Ada']);
		expect(errors()).toEqual([{ kind: 'error', action: 'contacts', code: 'storage' }]);
		// Every card of an import is kept, and the failure said once.
		expect(await client.importVCards(card('Grace') + card('Alan'))).toBe(2);
		expect(names()).toEqual(['Ada', 'Alan', 'Grace']);
		expect(errors()).toHaveLength(2);
		await client.deleteContact('ada');
		expect(names()).toEqual(['Alan', 'Grace']);
		expect(errors()).toHaveLength(3);

		await client.saveEvent(STAND_UP);
		expect(client.getState().events).toEqual([STAND_UP]);
		const file = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
		file.push(...event('one', '20261020T090000Z'), ...event('two', '20261021T090000Z'));
		expect(await client.importIcs([...file, 'END:VCALENDAR'].join('\r\n'))).toBe(2);
		expect(client.getState().events.map((e) => e.id)).toEqual(['one', 'stand-up', 'two']);
		await client.deleteEvent('stand-up');
		expect(client.getState().events.map((e) => e.id)).toEqual(['one', 'two']);
		expect(errors().slice(3)).toEqual([
			{ kind: 'error', action: 'calendar', code: 'storage' },
			{ kind: 'error', action: 'calendar', code: 'storage' },
			{ kind: 'error', action: 'calendar', code: 'storage' },
		]);
		client.destroy();
	});

	it('shows what the store holds when it fails otherwise', async () => {
		const memory = createMemoryContactStore();
		// A store of the host's own that takes the first card and then fails.
		const contacts: ContactStore = {
			list: () => memory.list(),
			remove: (id) => memory.remove(id),
			save: async (contact) => {
				if ((await memory.list()).length) throw new MailTransportError('network', 'Offline.');
				return memory.save(contact);
			},
		};
		const { client, errors } = setup(contacts);
		await until(client, (s) => s.status === 'ready');
		expect(await client.importVCards(card('Grace') + card('Alan'))).toBe(1);
		expect(client.getState().contacts.map((contact) => contact.name)).toEqual(['Grace']);
		expect(errors()).toEqual([{ kind: 'error', action: 'contacts', code: 'network' }]);
		client.destroy();
	});
});

describe('stores opened for the account', () => {
	const kim = { ...emptyContact('kim', 0), name: 'Kim' };

	it('opens the address book and calendar once connected, for the session that signed in', async () => {
		const transport = createMemoryTransport();
		const opened: unknown[] = [];
		const client = createMailClient({
			transport,
			openStores: (session) => {
				opened.push(session.account);
				return {
					contacts: createMemoryContactStore({ seed: [kim] }),
					calendar: createMemoryCalendarStore({ seed: [STAND_UP] }),
				};
			},
		});
		await until(client, (s) => s.status === 'ready' && s.contacts.length === 1);
		expect(opened).toEqual([client.getState().account]);
		expect(client.getState().events).toEqual([STAND_UP]);
		await client.saveContact({ ...emptyContact('lee', 0), name: 'Lee' });
		await client.refresh();
		expect(client.getState().contacts.map((c) => c.name)).toEqual(['Kim', 'Lee']);
		expect(opened).toHaveLength(1);
		client.destroy();
	});

	it('keeps a change made before the account is known, or says why it could not', async () => {
		const base = createMemoryTransport();
		let open: () => void = () => {};
		let down = false;
		const transport = {
			...base,
			connect: async () => {
				if (down) throw new MailTransportError('network', 'Offline.');
				await new Promise<void>((done) => (open = done));
				return base.connect();
			},
		};
		const contacts = createMemoryContactStore();
		const client = createMailClient({ transport, openStores: () => ({ contacts }) });
		const notices: MailNotice[] = [];
		client.onNotice((notice) => notices.push(notice));
		// Saved while the client still connects: it waits for the account, then is kept.
		const saving = client.saveContact({ ...emptyContact('kim', 0), name: 'Kim' });
		open();
		await saving;
		expect((await contacts.list()).map((c) => c.name)).toEqual(['Kim']);
		expect(client.getState().contacts.map((c) => c.name)).toEqual(['Kim']);
		client.destroy();
		// The server cannot be reached: the change is not lost without a word.
		down = true;
		const offline = createMailClient({ transport, openStores: () => ({ contacts }) });
		const told: MailNotice[] = [];
		offline.onNotice((notice) => told.push(notice));
		await until(offline, (s) => s.status === 'error');
		await offline.saveEvent(STAND_UP);
		expect(
			await offline.importVCards('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Lee\r\nEND:VCARD\r\n'),
		).toBe(0);
		// Each says what stopped it; the connection's own failure shows in the client's status.
		expect(told).toEqual([
			{ kind: 'error', action: 'calendar', code: 'network' },
			{ kind: 'error', action: 'contacts', code: 'network' },
		]);
		expect(notices).toEqual([]);
		offline.destroy();
	});

	it("uses the host's own stores first, and opens none before a connection works", async () => {
		const own = createMemoryContactStore({ seed: [kim] });
		const base = createMemoryTransport();
		let down = true;
		const transport = {
			...base,
			connect: () =>
				down ? Promise.reject(new MailTransportError('network', 'Offline.')) : base.connect(),
		};
		const opened: unknown[] = [];
		const client = createMailClient({
			transport,
			contacts: own,
			openStores: (session) => {
				opened.push(session.account.id);
				return { calendar: createMemoryCalendarStore({ seed: [STAND_UP] }) };
			},
		});
		await until(client, (s) => s.status === 'error');
		expect([opened, client.getState().events]).toEqual([[], []]);
		down = false;
		await client.refresh();
		expect(opened).toHaveLength(1);
		expect(client.getState().contacts.map((c) => c.name)).toEqual(['Kim']);
		expect(client.getState().events).toEqual([STAND_UP]);
		client.destroy();
	});
});
