// The `@`-mention typeahead of the comments pane's boxes (the new comment, each reply, the comment
// being edited): one draft of mention spans per box, kept in line with its text as it is typed, and
// the suggestion list under the box being typed in. The rules are the DOM-free ones in `mentions`;
// this only reads the boxes and draws the list.
import { html, nothing, type TemplateResult } from 'lit';
import {
	followTextEdit,
	insertMention,
	matchMentionCandidates,
	mentionQueryAt,
	normalizeLineBreaks,
	trimMentionText,
	type OfficeCommentMention,
	type OfficeMentionCandidate,
} from './mentions';

const LIST_ID = 'office-comment-mentions';
const optionId = (index: number) => `${LIST_ID}-${index}`;

export interface MentionTypeaheadHost {
	requestUpdate(): void;
	/** The people to offer; none turns the typeahead off. */
	offeredMentions(): readonly OfficeMentionCandidate[];
}

/** The ARIA a box carries: `aria-autocomplete` while it offers people, the list and option while open. */
export interface MentionBoxAria {
	autocomplete?: 'list';
	controls?: string;
	activeDescendant?: string;
}

interface Draft {
	text: string;
	mentions: readonly OfficeCommentMention[];
}

interface OpenList {
	key: string;
	box: HTMLTextAreaElement;
	start: number;
	query: string;
	matches: OfficeMentionCandidate[];
	index: number;
}

export class MentionTypeahead {
	private readonly host: MentionTypeaheadHost;
	private readonly drafts = new Map<string, Draft>();
	private list: OpenList | undefined;
	/** The `@` the user closed the list on with Escape: it stays closed until another `@` is typed. */
	private dismissed: { key: string; start: number } | undefined;

	constructor(host: MentionTypeaheadHost) {
		this.host = host;
	}

	/** Start a box's draft from text it already holds (the comment being edited), as the box shows it. */
	seed(key: string, text: string, mentions: readonly OfficeCommentMention[] | undefined): void {
		this.drafts.set(key, normalizeLineBreaks(text, mentions));
	}

	/** Forget a box's draft and close its list (after it posts, or when its edit ends). */
	clear(key: string): void {
		this.drafts.delete(key);
		if (this.dismissed?.key === key) this.dismissed = undefined;
		this.close(key);
	}

	/** Close the list if it is open under the box `key` (the box lost the focus). */
	close(key: string): void {
		if (this.list?.key !== key) return;
		this.list = undefined;
		this.host.requestUpdate();
	}

	/** After typing or a caret move in a box: follow its text, then open, refresh or close the list. */
	update(key: string, box: HTMLTextAreaElement): void {
		const caret = box.selectionStart ?? box.value.length;
		this.spans(key, box.value, caret);
		const before = this.list;
		this.match(key, box, caret);
		if (before || this.list) this.host.requestUpdate();
	}

	/** The people offered changed (or the pane locked): match the open list again, before it draws. */
	refresh(): void {
		const list = this.list;
		if (list) this.match(list.key, list.box, list.box.selectionStart ?? list.box.value.length);
	}

	/** A key pressed in a box: true when the open list took it (arrows, Enter, Tab, Escape). */
	keydown(key: string, event: KeyboardEvent): boolean {
		const list = this.list;
		if (list?.key !== key || event.isComposing) return false;
		const count = list.matches.length;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			list.index = (list.index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
			this.host.requestUpdate();
		} else if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
			const candidate = list.matches[list.index];
			if (candidate) this.pick(candidate);
		} else if (event.key === 'Escape') {
			// Escape closes the list only: the box, an edit and the host's own Escape stay as they are.
			event.stopPropagation();
			this.dismissed = { key, start: list.start };
			this.close(key);
		} else return false;
		event.preventDefault();
		return true;
	}

	/** A box's text and its spans as typed, for a host to keep while the pane is gone (see `seed`). */
	snapshot(key: string, text: string): { text: string; mentions: OfficeCommentMention[] } {
		return { text, mentions: [...this.spans(key, text)] };
	}

	/** What a box posts: its text trimmed and its spans moved with it. */
	take(key: string, box: HTMLTextAreaElement): { text: string; mentions: OfficeCommentMention[] } {
		return trimMentionText(box.value, this.spans(key, box.value));
	}

	aria(key: string, offered: boolean): MentionBoxAria {
		const list = this.list?.key === key ? this.list : undefined;
		return {
			...(offered ? { autocomplete: 'list' as const } : {}),
			...(list ? { controls: LIST_ID, activeDescendant: optionId(list.index) } : {}),
		};
	}

	/** The suggestion list under the box `key`, while it is open. */
	render(key: string, label: string): TemplateResult | typeof nothing {
		const list = this.list;
		if (list?.key !== key) return nothing;
		// A press keeps the focus in the box; the pick lands on the click, so the click still has the
		// option as its target (not the thread card under the list once it closes).
		return html`<div class="mentions" id=${LIST_ID} role="listbox" aria-label=${label}
			>${list.matches.map(
				(candidate, index) =>
					html`<button
						type="button"
						role="option"
						tabindex="-1"
						id=${optionId(index)}
						aria-selected=${String(index === list.index)}
						@mousedown=${(event: MouseEvent) => event.preventDefault()}
						@click=${() => this.pick(candidate)}
						>${candidate.name}</button
					>`,
			)}</div
		>`;
	}

	/** Put the candidate in place of the `@` token being typed, as `@Name `, and keep the box focused. */
	private pick(candidate: OfficeMentionCandidate): void {
		const list = this.list;
		if (!list) return;
		const { key, box } = list;
		const caret = box.selectionStart ?? box.value.length;
		const next = insertMention(box.value, this.spans(key, box.value), caret, candidate);
		box.value = next.text;
		this.drafts.set(key, { text: next.text, mentions: next.mentions });
		this.close(key);
		box.focus();
		box.setSelectionRange(next.caret, next.caret);
	}

	/** Open, refresh or close the list for the `@` token left of `caret` in the box `key`. */
	private match(key: string, box: HTMLTextAreaElement, caret: number): void {
		const candidates = box.disabled ? [] : this.host.offeredMentions();
		const token = candidates.length ? mentionQueryAt(box.value, caret) : null;
		if (this.dismissed && (this.dismissed.key !== key || this.dismissed.start !== token?.start))
			this.dismissed = undefined;
		const matches = token && !this.dismissed ? matchMentionCandidates(candidates, token.query) : [];
		const list = this.list;
		if (!token || !matches.length) {
			if (list?.key === key) this.list = undefined;
			return;
		}
		const same = list?.key === key && list.start === token.start && list.query === token.query;
		const index = same ? Math.min(list.index, matches.length - 1) : 0;
		this.list = { key, box, ...token, matches, index };
	}

	/** The box's spans, in line with its current text (`caret` places an ambiguous edit). */
	private spans(key: string, text: string, caret?: number): readonly OfficeCommentMention[] {
		const draft = this.drafts.get(key);
		if (!draft) return [];
		if (draft.text === text) return draft.mentions;
		const mentions = followTextEdit(draft.text, text, draft.mentions, caret);
		this.drafts.set(key, { text, mentions });
		return mentions;
	}
}
