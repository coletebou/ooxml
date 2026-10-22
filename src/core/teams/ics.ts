// Export a meeting as an iCalendar (RFC 5545) file. The start and end carry the organiser's zone
// (TZID) with a VTIMEZONE block derived from the platform's zone data, so a repeating meeting keeps
// its wall-clock time across daylight saving in any calendar app; a UTC organiser uses plain UTC
// times. A repeat is one event with an RRULE (COUNT or UNTIL), cancelled occurrences are EXDATEs and
// a changed occurrence is an overriding event with the same UID and a RECURRENCE-ID. There are no
// attendee addresses in a workspace without accounts, so names go in the description. The value
// formats and the RRULE are the calendar area's (`ooxml-core/calendar`). DOM-free. New code.
import { vtimezoneLines } from '../calendar/ics-timezone';
import {
	icsAlarm,
	icsDateTime,
	icsEscape,
	icsFileName as eventIcsFileName,
	icsFold,
	icsRecurrence,
	icsUtc,
	isUtcZone,
} from '../calendar/ics-write';
import { zonedParts } from '../calendar/time-zone';
import type { Meeting } from './meetings';

export { icsDateTime, icsEscape, icsFold, icsLocal, icsUtc } from '../calendar/ics-write';

export interface IcsOptions {
	now?: number;
	/** Shown in the calendar app's event link; omitted when empty. */
	url?: string;
}

/** The `.ics` text (CRLF line endings) for one meeting, with its changed occurrences. */
export function meetingToIcs(meeting: Meeting, options: IcsOptions = {}): string {
	const people = [
		`Organizer: ${meeting.organizerName}`,
		...(meeting.attendees.length
			? [`Attendees: ${meeting.attendees.map((a) => a.name).join(', ')}`]
			: []),
	];
	const details = (text: string): string =>
		`DESCRIPTION:${icsEscape([text, ...people].filter(Boolean).join('\n\n'))}`;
	const uid = `UID:${meeting.id}@openteams`;
	const stamp = `DTSTAMP:${icsUtc(options.now ?? Date.now())}`;
	const status = `STATUS:${meeting.cancelled ? 'CANCELLED' : 'CONFIRMED'}`;
	const link = options.url ? [`URL:${options.url}`] : [];
	// A series keeps local time, which its repeats follow (`icsDateTime`).
	const repeats = meeting.repeat !== 'none';
	const changed =
		meeting.repeat === 'none' ? [] : (meeting.exceptions ?? []).filter((e) => !e.cancelled);
	const years = [
		meeting.start,
		...changed.flatMap((e) => [e.originalStart, e.start ?? e.originalStart]),
	].map((t) => zonedParts(t, meeting.zone).year);
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//OpenTeams//Calendar//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		...(isUtcZone(meeting.zone) ? [] : vtimezoneLines(meeting.zone, Math.min(...years))),
		'BEGIN:VEVENT',
		uid,
		stamp,
		icsDateTime('DTSTART', meeting.start, meeting.zone, repeats),
		icsDateTime('DTEND', meeting.end, meeting.zone, repeats),
		`SUMMARY:${icsEscape(meeting.title)}`,
		details(meeting.description),
		...icsRecurrence(meeting),
		...link,
		status,
		...icsAlarm(meeting.title, 5),
		'END:VEVENT',
		...changed.flatMap((e) => {
			const start = e.start ?? e.originalStart;
			const end = e.end ?? start + (meeting.end - meeting.start);
			const title = e.title ?? meeting.title;
			return [
				'BEGIN:VEVENT',
				uid,
				stamp,
				icsDateTime('RECURRENCE-ID', e.originalStart, meeting.zone, true),
				icsDateTime('DTSTART', start, meeting.zone, true),
				icsDateTime('DTEND', end, meeting.zone, true),
				`SUMMARY:${icsEscape(title)}`,
				details(e.description ?? meeting.description),
				...link,
				status,
				...icsAlarm(title, 5),
				'END:VEVENT',
			];
		}),
		'END:VCALENDAR',
	];
	return `${lines.flatMap(icsFold).join('\r\n')}\r\n`;
}

/** A safe download name such as `Weekly-sync.ics`. */
export const icsFileName = (meeting: Pick<Meeting, 'title'>): string =>
	eventIcsFileName(meeting, 'meeting');
