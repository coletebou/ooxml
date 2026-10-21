import * as Y from 'yjs';
import { createMeetingStore } from './meetings';
import { HOUR_MS, zonedToUtc } from './time-zone';

// The series rules (counts, end dates, cancelled and changed occurrences) are tested with the
// calendar area (src/core/calendar/recurrence.test.ts); this file pins how the meeting store keeps
// them.
const NY = 'America/New_York';
const at = (month: number, day: number, hour = 9, zone = NY): number =>
	zonedToUtc({ year: 2026, month, day, hour }, zone);

describe('meeting store exceptions', () => {
	const ada = { id: 'ada', name: 'Ada' };
	const make = () => {
		const doc = new Y.Doc();
		const store = createMeetingStore(doc, ada);
		const m = store.create({
			title: 'Sync',
			start: at(3, 2),
			end: at(3, 2) + HOUR_MS,
			repeat: 'daily',
			zone: NY,
			count: 5,
		})!;
		return { doc, store, m };
	};

	it('stores a count or an end date, never both', () => {
		const { store, m } = make();
		expect(m.count).toBe(5);
		const dated = store.update(m.id, { until: at(3, 9) })!;
		expect(dated.until).toBe(at(3, 9));
		expect(dated.count).toBeUndefined();
		const counted = store.update(m.id, { count: 3 })!;
		expect(counted.count).toBe(3);
		expect(counted.until).toBeUndefined();
		const never = store.update(m.id, { count: null })!;
		expect(never.count).toBeUndefined();
		expect(never.until).toBeUndefined();
		expect(store.update(m.id, { until: at(3, 1) })).toBeNull();
	});

	it('cancels and edits single occurrences, rejecting times that are not occurrences', () => {
		const { store, m } = make();
		expect(store.cancelOccurrence(m.id, at(3, 3))).toBe(true);
		expect(store.cancelOccurrence(m.id, at(3, 3, 10))).toBe(false);
		expect(store.cancelOccurrence(m.id, at(3, 20))).toBe(false);
		const edited = store.editOccurrence(m.id, at(3, 4), {
			title: '<b>Late</b> sync',
			start: at(3, 4, 15),
			end: at(3, 4, 16),
		})!;
		expect(edited.exceptions).toEqual([
			{ originalStart: at(3, 3), cancelled: true },
			{
				originalStart: at(3, 4),
				cancelled: false,
				start: at(3, 4, 15),
				end: at(3, 4, 16),
				title: 'Late sync',
			},
		]);
		expect(
			store.editOccurrence(m.id, at(3, 4), { start: at(3, 4, 16), end: at(3, 4, 15) }),
		).toBeNull();
		expect(store.editOccurrence(m.id, at(3, 5), { title: ' ' })).toBeNull();
		const again = store.editOccurrence(m.id, at(3, 4), { description: 'Bring notes' })!;
		expect(again.exceptions?.[1]).toMatchObject({ title: 'Late sync', description: 'Bring notes' });
	});

	it('only lets the organizer change occurrences, and syncs them to other peers', () => {
		const { doc, store, m } = make();
		store.cancelOccurrence(m.id, at(3, 3));
		const other = new Y.Doc();
		Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
		const bob = createMeetingStore(other, { id: 'bob', name: 'Bob' });
		expect(bob.get(m.id)?.exceptions).toHaveLength(1);
		expect(bob.cancelOccurrence(m.id, at(3, 4))).toBe(false);
		expect(bob.editOccurrence(m.id, at(3, 4), { title: 'x' })).toBeNull();
	});

	it('voids exceptions when the series is rescheduled or stops repeating', () => {
		const { store, m } = make();
		store.cancelOccurrence(m.id, at(3, 3));
		expect(store.update(m.id, { title: 'Renamed' })!.exceptions).toHaveLength(1);
		const moved = store.update(m.id, { start: at(3, 2, 10), end: at(3, 2, 11) })!;
		expect(moved.exceptions).toBeUndefined();
		store.cancelOccurrence(m.id, at(3, 3, 10));
		const single = store.update(m.id, { repeat: 'none' })!;
		expect(single.exceptions).toBeUndefined();
		expect(single.count).toBeUndefined();
	});

	it('ignores malformed stored exceptions', () => {
		const { doc, m } = make();
		const row = doc.getMap<Y.Map<unknown>>('teams:meetings').get(m.id)!;
		const bad = new Y.Map<unknown>();
		bad.set('nope', { cancelled: true });
		bad.set(String(at(3, 3)), { start: 5 });
		bad.set(String(at(3, 4)), 'text');
		bad.set(String(at(3, 5)), { cancelled: true });
		row.set('exceptions', bad);
		const read = createMeetingStore(doc, ada).get(m.id)!;
		expect(read.exceptions).toEqual([{ originalStart: at(3, 5), cancelled: true }]);
	});
});
