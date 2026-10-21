// <mail-calendar>: the mail app's calendar. The shared calendar view (`../calendar/calendar-grid`,
// here as <mail-calendar-grid>) shows a day, a week or a month with Today, previous and next and
// the view switch; New event, a click on a free slot or day, and a click on an event open the event
// dialog (`event-dialog.ts`), and the bar imports and exports iCalendar (.ics) files. Every change
// is an event; the app saves through the client.
import { html, nothing } from 'lit';
import {
	localZone,
	type CalendarEvent,
	type CalendarMode,
	type Occurrence,
} from 'ooxml-core/calendar';
import type { MessageParams } from 'ooxml-core/i18n';
import {
	CALENDAR_GRID_CSS,
	CalendarGridView,
	type CalendarGlyph,
	type CalendarLabel,
} from '../calendar/calendar-grid';
import {
	buildEvent,
	draftOf,
	newDraft,
	type DraftIssue,
	type EventDraft,
} from '../calendar/event-draft';
import { defineOnce, MailElement, mailStyles } from './base';
import { eventDialog, ISSUE_FIELD, readDraft, type EventDialogHandlers } from './event-dialog';
import { mailI18n, type MailKey } from './i18n/translator';
import { icon } from './icons';
import { FocusReturn } from './modal';
import css from './calendar-pane.css?raw';
import dialogCss from './event-dialog.css?raw';

const MODES: readonly CalendarMode[] = ['day', 'week', 'month'];

const LABELS: Record<Exclude<CalendarLabel, 'more'>, MailKey> = {
	title: 'calendar.title',
	today: 'calendar.today',
	viewLabel: 'calendar.view',
	new: 'calendar.newEvent',
	'mode.day': 'calendar.day',
	'mode.workweek': 'calendar.workWeek',
	'mode.week': 'calendar.week',
	'mode.month': 'calendar.month',
	'previous.day': 'calendar.previousDay',
	'previous.week': 'calendar.previousWeek',
	'previous.month': 'calendar.previousMonth',
	'next.day': 'calendar.nextDay',
	'next.week': 'calendar.nextWeek',
	'next.month': 'calendar.nextMonth',
	allDay: 'calendar.allDay',
	openDay: 'calendar.openDay',
	untitled: 'calendar.untitled',
};

const GLYPHS: Record<CalendarGlyph, string> = {
	previous: 'chevronLeft',
	next: 'chevronRight',
	new: 'plus',
};

const newId = (): string =>
	globalThis.crypto?.randomUUID?.() ??
	`event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The shared calendar view in the mail app's wording and look, with the day, week and month views.
 * It tells its host `mail-calendar-open` `{ id, start }` (an event was activated) and
 * `mail-calendar-new` `{ start, allDay }` (a new event is proposed; the New button's starts at the
 * next half hour of today or at 9:00 on the shown day).
 */
export class MailCalendarGrid extends CalendarGridView<CalendarEvent> {
	static override styles = mailStyles(CALENDAR_GRID_CSS);
	static override properties = { events: { attribute: false } };
	declare events: readonly CalendarEvent[];

	constructor() {
		super();
		this.events = [];
	}

	protected override modes(): readonly CalendarMode[] {
		return MODES;
	}

	protected override items(): readonly CalendarEvent[] {
		return this.events;
	}

	protected override label(key: CalendarLabel, params?: MessageParams): string {
		const i18n = mailI18n(this.locale);
		if (key === 'more') return i18n.tn('calendar.more', Number(params?.count ?? 0), params);
		return i18n.t(LABELS[key], params);
	}

	protected override intlLocale(): string | undefined {
		return mailI18n(this.locale).intl;
	}

	protected override glyph(kind: CalendarGlyph) {
		return icon(GLYPHS[kind]);
	}

	protected override openOccurrence(event: CalendarEvent, occurrence: Occurrence): void {
		this.fire('mail-calendar-open', { id: event.id, start: occurrence.start });
	}

	protected override proposeEvent(start: number, allDay: boolean): void {
		this.fire('mail-calendar-new', { start: start || this.suggestedStart(), allDay });
	}
}

/**
 * The calendar of the mail app. Properties: `events`, `zone` (IANA, this device's by default),
 * `now` (0 reads the clock; for tests) and `locale` (inherited). Emits `mail-save-event`
 * `{ event }`, `mail-delete-event` `{ id }`, `mail-import-ics` `{ text }` (one per file) and
 * `mail-export-ics` `{ ids? }` (every event when `ids` is omitted).
 */
export class MailCalendar extends MailElement {
	static override styles = mailStyles(css, dialogCss);
	static override properties = {
		...MailElement.properties,
		events: { attribute: false },
		zone: { type: String },
		now: { type: Number },
		draft: { state: true },
		issue: { state: true },
	};
	declare events: readonly CalendarEvent[];
	declare zone: string;
	declare now: number;
	/** The event in the dialog, or null while it is closed. */
	declare draft: EventDraft | null;
	declare issue: DraftIssue | '';
	/** What had the focus when the dialog opened, focused again when it closes. */
	private readonly opener = new FocusReturn();
	/** The field to focus once the next update is drawn. */
	private focusField = '';

	constructor() {
		super();
		this.events = [];
		this.zone = localZone();
		this.now = 0;
		this.draft = null;
		this.issue = '';
	}

	override connectedCallback(): void {
		defineOnce('mail-calendar-grid', MailCalendarGrid);
		super.connectedCallback();
	}

	protected override updated(): void {
		if (!this.focusField) return;
		this.renderRoot.querySelector<HTMLElement>(`[name="${this.focusField}"]`)?.focus();
		this.focusField = '';
	}

	private openDialog(draft: EventDraft): void {
		if (this.shadowRoot) this.opener.take(this.shadowRoot);
		this.issue = '';
		this.draft = draft;
		this.focusField = 'title';
	}

	private closeDialog(): void {
		this.draft = null;
		this.issue = '';
		void this.updateComplete.then(() => this.opener.restore());
	}

	private save(form: HTMLFormElement): void {
		if (!this.draft) return;
		const draft = readDraft(form, this.draft);
		const result = buildEvent(draft, this.zone, newId);
		if ('issue' in result) {
			this.draft = draft;
			this.issue = result.issue;
			this.focusField = ISSUE_FIELD[result.issue];
			return;
		}
		this.emit('mail-save-event', { event: result.event });
		this.closeDialog();
	}

	private deleteEvent(): void {
		const event = this.draft?.original;
		if (!event) return;
		const title = event.title || this.t('calendar.untitled');
		const question =
			event.repeat === 'none' ? 'calendar.confirmDelete' : 'calendar.confirmDeleteSeries';
		if (globalThis.confirm?.(this.t(question, { title })) === false) return;
		this.emit('mail-delete-event', { id: event.id });
		this.closeDialog();
	}

	private async importFiles(input: HTMLInputElement): Promise<void> {
		const files = [...(input.files ?? [])];
		input.value = '';
		for (const file of files) this.emit('mail-import-ics', { text: await file.text() });
	}

	private readonly handlers: EventDialogHandlers = {
		change: (draft) => (this.draft = draft),
		save: (form) => this.save(form),
		cancel: () => this.closeDialog(),
		remove: () => this.deleteEvent(),
		exportEvent: (id) => this.emit('mail-export-ics', { ids: [id] }),
	};

	protected override render() {
		return html`<mail-calendar-grid
				.events=${this.events}
				.zone=${this.zone}
				.now=${this.now}
				@mail-calendar-open=${(e: CustomEvent<{ id: string }>) => {
					e.stopPropagation();
					const event = this.events.find((x) => x.id === e.detail.id);
					if (event) this.openDialog(draftOf(event, this.zone));
				}}
				@mail-calendar-new=${(e: CustomEvent<{ start: number; allDay: boolean }>) => {
					e.stopPropagation();
					this.openDialog(newDraft(e.detail.start, e.detail.allDay, this.zone));
				}}
				><button
					type="button"
					slot="actions"
					class="tool"
					title=${this.t('calendar.importHint')}
					@click=${() => this.renderRoot.querySelector<HTMLInputElement>('input.file')?.click()}
				>
					${icon('mail-import')}<span>${this.t('calendar.import')}</span></button
				><button
					type="button"
					slot="actions"
					class="tool"
					title=${this.t('calendar.exportHint')}
					?disabled=${!this.events.length}
					@click=${() => this.emit('mail-export-ics', {})}
				>
					${icon('mail-export')}<span>${this.t('calendar.export')}</span>
				</button></mail-calendar-grid
			>
			<input
				class="file"
				type="file"
				accept=".ics,text/calendar"
				multiple
				hidden
				@change=${(e: Event) => void this.importFiles(e.currentTarget as HTMLInputElement)}
			/>
			${this.draft ? eventDialog(this.draft, this.issue, this.zone, this.i18n, this.handlers) : nothing}`;
	}
}

/** Define `<mail-calendar>` and the calendar view it shows. */
export function defineMailCalendar(): void {
	defineOnce('mail-calendar-grid', MailCalendarGrid);
	defineOnce('mail-calendar', MailCalendar);
}
