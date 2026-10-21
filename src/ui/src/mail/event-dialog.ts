// The event dialog of <mail-calendar>: create or edit one event (title, all day, start and end,
// repeat, location and description) with Save, Cancel, Export and Delete, over the drafts of
// `../calendar/event-draft` (wall-clock times in the calendar's zone, an all-day end date that is
// the last day). Moving the start keeps the length. The dialog is modal: Tab stays inside, Escape
// closes it, and the app's shortcuts never see its keys. New code.
import { html, nothing } from 'lit';
import { REPEATS, type Repeat } from 'ooxml-core/calendar';
import { keepLength, type DraftIssue, type EventDraft } from '../calendar/event-draft';
import type { MailI18n, MailKey } from './i18n/translator';
import { icon } from './icons';

/** The message of each issue. */
export const ISSUE_TEXT: Record<DraftIssue, MailKey> = {
	title: 'calendar.titleRequired',
	when: 'calendar.pickWhen',
	order: 'calendar.endBeforeStart',
};

/** The field to put the focus on for an issue. */
export const ISSUE_FIELD: Record<DraftIssue, string> = {
	title: 'title',
	when: 'startDate',
	order: 'endDate',
};

const REPEAT_TEXT: Record<Repeat, MailKey> = {
	none: 'calendar.repeat.none',
	daily: 'calendar.repeat.daily',
	weekly: 'calendar.repeat.weekly',
	monthly: 'calendar.repeat.monthly',
	yearly: 'calendar.repeat.yearly',
};

/** The draft as the form now reads. */
export function readDraft(form: HTMLFormElement, previous: EventDraft): EventDraft {
	const data = new FormData(form);
	const text = (name: string): string => {
		const value = data.get(name);
		return typeof value === 'string' ? value : '';
	};
	const repeat = text('repeat');
	return {
		...previous,
		title: text('title'),
		allDay: data.has('allDay'),
		startDate: text('startDate'),
		startTime: text('startTime'),
		endDate: text('endDate'),
		endTime: text('endTime'),
		location: text('location'),
		description: text('description'),
		repeat: (REPEATS as readonly string[]).includes(repeat) ? (repeat as Repeat) : 'none',
	};
}

export interface EventDialogHandlers {
	/** The form changed: the dialog redraws from this draft (all day switched, the start moved). */
	change(draft: EventDraft): void;
	save(form: HTMLFormElement): void;
	cancel(): void;
	remove(): void;
	exportEvent(id: string): void;
}

/** Trap Tab inside the dialog and close it with Escape; app shortcuts never see its keys. */
function keydown(event: KeyboardEvent, on: EventDialogHandlers): void {
	event.stopPropagation();
	if (event.key === 'Escape') {
		event.preventDefault();
		on.cancel();
		return;
	}
	if (event.key !== 'Tab') return;
	const dialog = event.currentTarget as HTMLElement;
	const stops = [...dialog.querySelectorAll<HTMLElement>('input, select, textarea, button')].filter(
		(el) => !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled,
	);
	const active = (dialog.getRootNode() as Document | ShadowRoot).activeElement;
	const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
	if (active !== edge) return;
	event.preventDefault();
	(event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
}

/** The dialog over the calendar for `draft`, with the message of `issue` when there is one. */
export function eventDialog(
	draft: EventDraft,
	issue: DraftIssue | '',
	zone: string,
	i18n: MailI18n,
	on: EventDialogHandlers,
) {
	const t = i18n.t;
	const original = draft.original;
	const invalid = (name: string) => (issue && ISSUE_FIELD[issue] === name ? 'true' : 'false');
	const described = (name: string) => (invalid(name) === 'true' ? 'event-issue' : nothing);
	const input = (name: string, label: MailKey, type: string, value: string, hidden = false) =>
		html`<label ?hidden=${hidden}
			><span>${t(label)}</span
			><input
				name=${name}
				type=${type}
				.value=${value}
				aria-invalid=${invalid(name)}
				aria-describedby=${described(name)}
		/></label>`;
	const repeats = original && original.repeat !== 'none';
	return html`<div class="overlay">
		<section
			class="event-dialog"
			role="dialog"
			aria-modal="true"
			aria-labelledby="event-dialog-title"
			@keydown=${(e: KeyboardEvent) => keydown(e, on)}
		>
			<form
				novalidate
				@submit=${(e: Event) => {
					e.preventDefault();
					on.save(e.currentTarget as HTMLFormElement);
				}}
				@change=${(e: Event) => {
					const form = e.currentTarget as HTMLFormElement;
					const next = readDraft(form, draft);
					const name = (e.target as HTMLInputElement).name;
					on.change(
						name === 'startDate' || name === 'startTime' ? keepLength(next, draft, zone) : next,
					);
				}}
			>
				<header>
					<h2 id="event-dialog-title">
						${t(original ? 'calendar.editTitle' : 'calendar.newEvent')}
					</h2>
					<button
						type="button"
						class="icon-button"
						aria-label=${t('calendar.close')}
						title=${t('calendar.close')}
						@click=${() => on.cancel()}
					>
						${icon('close')}
					</button>
				</header>
				${input('title', 'calendar.eventTitle', 'text', draft.title)}
				<label class="check"
					><input name="allDay" type="checkbox" .checked=${draft.allDay} /><span
						>${t('calendar.allDay')}</span
					></label
				>
				<div class="when">
					${input('startDate', 'calendar.startDate', 'date', draft.startDate)}
					${input('startTime', 'calendar.startTime', 'time', draft.startTime, draft.allDay)}
					${input('endDate', 'calendar.endDate', 'date', draft.endDate)}
					${input('endTime', 'calendar.endTime', 'time', draft.endTime, draft.allDay)}
				</div>
				<p class="note">
					${t('calendar.zoneNote', { zone: draft.allDay ? (original?.zone ?? zone) : zone })}
				</p>
				<label
					><span>${t('calendar.repeat')}</span
					><select name="repeat">
						${REPEATS.map((r) => html`<option value=${r} ?selected=${r === draft.repeat}>${t(REPEAT_TEXT[r])}</option>`)}
					</select></label
				>
				${repeats ? html`<p class="note">${t('calendar.seriesNote')}</p>` : nothing}
				${input('location', 'calendar.location', 'text', draft.location)}
				<label
					><span>${t('calendar.description')}</span
					><textarea name="description" rows="3" .value=${draft.description}></textarea>
				</label>
				${issue ? html`<p class="issue" id="event-issue" role="alert">${t(ISSUE_TEXT[issue])}</p>` : nothing}
				<footer>
					<button type="submit" class="primary">${t('calendar.save')}</button>
					<button type="button" @click=${() => on.cancel()}>${t('calendar.cancel')}</button>
					${
						original
							? html`<span class="spacer"></span>
									<button type="button" @click=${() => on.exportEvent(original.id)}>
										${icon('mail-export')}<span>${t('calendar.exportEvent')}</span>
									</button>
									<button type="button" class="danger" @click=${() => on.remove()}>
										${icon('trash')}<span>${t('calendar.delete')}</span>
									</button>`
							: nothing
					}
				</footer>
			</form>
		</section>
	</div>`;
}
