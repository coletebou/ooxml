// <notebook-ink>: a page's ink, drawn as filled outlines (`inkOutline` from the core) in page
// pixels, and the surface the pen, highlighter and eraser draw on. Pointer events carry pressure
// (a pen's real pressure, 0.5 for a mouse); coalesced events keep fast strokes smooth. A finished
// stroke and an erase are one event each, so each is one undo step.
import { html, nothing, svg } from 'lit';
import { type InkStroke, inkHits, inkOutline } from 'ooxml-core/notebook';
import { controlStyles } from '../base';
import { definer } from '../registry';
import { NotebookElement } from './base';
import css from './ink-layer.css?raw';

export type InkToolName = 'pen' | 'highlighter' | 'eraser';

export interface StrokeDetail {
	tool: 'pen' | 'highlighter';
	color: string;
	width: number;
	points: number[];
}

const ERASER_RADIUS = 6;

export class NotebookInk extends NotebookElement {
	static override styles = controlStyles(css);
	static override properties = {
		strokes: { attribute: false },
		tool: { type: String },
		color: { type: String },
		width: { type: Number },
		live: { state: true },
		erased: { state: true },
	};
	declare strokes: readonly InkStroke[];
	/** The active ink tool, or empty when typing (the layer then lets pointers through). */
	declare tool: InkToolName | '';
	declare color: string;
	declare width: number;
	declare live: number[] | null;
	declare erased: ReadonlySet<string>;
	#pointer = -1;
	/** Where the eraser was last, so the way from there is erased too. */
	#eraserAt: { x: number; y: number } | null = null;

	constructor() {
		super();
		this.strokes = [];
		this.tool = '';
		this.color = '#202020';
		this.width = 2;
		this.live = null;
		this.erased = new Set();
	}

	protected override willUpdate(): void {
		this.toggleAttribute('drawing', !!this.tool);
	}

	#point(event: PointerEvent): [number, number, number] {
		const svgEl = this.renderRoot.querySelector('svg')!;
		const rect = svgEl.getBoundingClientRect();
		const scale = svgEl.clientWidth ? rect.width / svgEl.clientWidth : 1;
		const pressure = event.pointerType === 'mouse' || !event.pressure ? 0.5 : event.pressure;
		return [(event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale, pressure];
	}

	/** Erase along the eraser's way through each position the event reports (fast swipes coalesce). */
	#erase(event: PointerEvent): void {
		const events = event.type === 'pointermove' ? (event.getCoalescedEvents?.() ?? []) : [];
		const erased = new Set(this.erased);
		for (const e of events.length ? events : [event]) {
			const [x, y] = this.#point(e);
			const from = this.#eraserAt ?? { x, y };
			for (const s of this.strokes)
				if (!erased.has(s.id) && inkHits(s, x, y, ERASER_RADIUS, from)) erased.add(s.id);
			this.#eraserAt = { x, y };
		}
		if (erased.size !== this.erased.size) this.erased = erased;
	}

	#down(event: PointerEvent): void {
		if (!this.tool || event.button !== 0 || this.#pointer !== -1) return;
		event.preventDefault();
		this.#pointer = event.pointerId;
		(event.currentTarget as Element).setPointerCapture?.(event.pointerId);
		this.#eraserAt = null;
		if (this.tool === 'eraser') this.#erase(event);
		else this.live = [...this.#point(event)];
	}

	#move(event: PointerEvent): void {
		if (event.pointerId !== this.#pointer) return;
		if (this.tool === 'eraser') return this.#erase(event);
		if (!this.live) return;
		const events = event.getCoalescedEvents?.() ?? [event];
		const next = [...this.live];
		for (const e of events.length ? events : [event]) next.push(...this.#point(e));
		this.live = next;
	}

	#up(event: PointerEvent): void {
		if (event.pointerId !== this.#pointer) return;
		this.#pointer = -1;
		if (this.tool === 'eraser') {
			// The way from the last move to where it was lifted (lost capture reports no position).
			if (event.type === 'pointerup') this.#erase(event);
			if (this.erased.size) this.fire('nb-erase', { ids: [...this.erased] });
			this.erased = new Set();
			return;
		}
		const points = this.live;
		this.live = null;
		// The line runs on to where it was lifted, at the pressure it had (a pen reports none then).
		if (points && event.type === 'pointerup') {
			const [x, y] = this.#point(event);
			const at = points.length - 3;
			if (at >= 0 && (points[at] !== x || points[at + 1] !== y))
				points.push(x, y, points[at + 2] ?? 0.5);
		}
		if (points && points.length >= 3 && (this.tool === 'pen' || this.tool === 'highlighter'))
			this.fire('nb-stroke', {
				tool: this.tool,
				color: this.color,
				width: this.width,
				points,
			} satisfies StrokeDetail);
	}

	/** Only the drawing pointer's cancel ends the gesture (a palm rejected beside a pen is another). */
	#cancel(event: PointerEvent): void {
		if (event.pointerId !== this.#pointer) return;
		this.#pointer = -1;
		this.live = null;
		this.erased = new Set();
	}

	protected override render() {
		const liveTool = this.tool === 'highlighter' ? 'highlighter' : 'pen';
		return html`<svg
			role="img"
			aria-label=${this.t('ink.label')}
			@pointerdown=${(e: PointerEvent) => this.#down(e)}
			@pointermove=${(e: PointerEvent) => this.#move(e)}
			@pointerup=${(e: PointerEvent) => this.#up(e)}
			@pointercancel=${(e: PointerEvent) => this.#cancel(e)}
			@lostpointercapture=${(e: PointerEvent) => (e.pointerId === this.#pointer ? this.#up(e) : undefined)}
		>
			${this.strokes.map((s) =>
				this.erased.has(s.id)
					? nothing
					: svg`<path class=${s.tool} data-stroke=${s.id} fill=${s.color} d=${inkOutline(s.points, s.width, s.tool)}></path>`,
			)}${
				this.live
					? svg`<path class=${`${liveTool} live`} fill=${this.color} d=${inkOutline(this.live, this.width, liveTool)}></path>`
					: nothing
			}
		</svg>`;
	}
}

export const defineNotebookInk = definer('notebook-ink', () => NotebookInk);
