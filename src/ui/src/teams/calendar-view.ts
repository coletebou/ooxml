// The Teams calendar under its own tag: the shared calendar view (`../calendar/calendar-grid`) over
// the workspace's meetings, with the work week, week and day views, worded from the Teams
// dictionaries, drawn in the Teams look and answering with the `office-calendar-*` events. The
// grid itself moved to the shared module so the mail app can show the same calendar.
import type { CalendarMode, Occurrence } from 'ooxml-core/calendar';
import type { MessageParams } from 'ooxml-core/i18n';
import type { CalendarMode as MeetingCalendarMode, MeetingView } from 'ooxml-core/teams';
import {
	CALENDAR_GRID_CSS,
	CalendarGridView,
	type CalendarGlyph,
	type CalendarLabel,
} from '../calendar/calendar-grid';
import { definer } from '../registry';
import { withStyles } from './base';
import { teamsI18n, type TeamsKey } from './i18n/translator';
import { icon } from './icons';
import css from './calendar-view.css?raw';

const MODES: readonly MeetingCalendarMode[] = ['workweek', 'week', 'day'];

/** The Teams wording of the shared view; the labels it never shows (the month) stay empty. */
const LABELS: Partial<Record<CalendarLabel, TeamsKey>> = {
	title: 'calendar.title',
	today: 'time.today',
	viewLabel: 'calendar.viewLabel',
	new: 'calendar.newMeeting',
	'mode.workweek': 'calendar.workWeek',
	'mode.week': 'calendar.week',
	'mode.day': 'calendar.day',
	'previous.day': 'calendar.previousDay',
	'previous.week': 'calendar.previousWeek',
	'next.day': 'calendar.nextDay',
	'next.week': 'calendar.nextWeek',
};

/**
 * A Teams-style calendar: a time grid for the work week, the full week or one day in the viewer's
 * zone, with Today, previous and next, and the view switch. Overlapping meetings share a column.
 * Properties: `meetings` (core `MeetingView[]`), `zone` (default: this device's), `now` (the
 * clock, for tests), `mode`. Events: `office-calendar-open` `{ meetingId, start }`,
 * `office-calendar-new` `{ start }` (a click on an empty slot, or the New meeting button), and
 * `office-calendar-mode` `{ mode }`.
 */
export class OfficeUiCalendarView extends CalendarGridView<MeetingView> {
	static override styles = withStyles(`${CALENDAR_GRID_CSS}\n${css}`);
	static override defaultMode: CalendarMode = 'workweek';
	static override properties = { meetings: { attribute: false } };
	declare meetings: MeetingView[];
	declare mode: MeetingCalendarMode;

	constructor() {
		super();
		this.meetings = [];
	}

	protected override modes(): readonly MeetingCalendarMode[] {
		return MODES;
	}

	protected override items(): readonly MeetingView[] {
		return this.meetings;
	}

	protected override label(key: CalendarLabel, params?: MessageParams): string {
		const name = LABELS[key];
		return name ? teamsI18n(this.locale).t(name, params) : '';
	}

	protected override intlLocale(): string | undefined {
		return teamsI18n(this.locale).intl;
	}

	protected override glyph(kind: CalendarGlyph) {
		return icon(kind === 'new' ? 'plus' : 'back');
	}

	protected override openOccurrence(meeting: MeetingView, occurrence: Occurrence): void {
		this.fire('office-calendar-open', { meetingId: meeting.id, start: occurrence.start });
	}

	protected override proposeEvent(start: number): void {
		this.fire('office-calendar-new', { start });
	}

	protected override modeChanged(mode: CalendarMode): void {
		this.fire('office-calendar-mode', { mode });
	}
}

export const defineCalendarView = definer('office-ui-calendar-view', () => OfficeUiCalendarView);
