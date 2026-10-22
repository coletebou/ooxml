import type { InkStroke } from 'ooxml-core/notebook';
import { type NotebookInk, defineNotebookInk } from './ink-layer';

const pointer = (type: string, x: number, y: number) =>
	new PointerEvent(type, {
		bubbles: true,
		button: 0,
		pointerId: 1,
		pointerType: 'mouse',
		clientX: x,
		clientY: y,
	});

describe('<notebook-ink> eraser', () => {
	it('erases what a fast swipe crosses between the positions it reports', async () => {
		defineNotebookInk();
		const ink = document.createElement('notebook-ink') as NotebookInk;
		// A short upright stroke at x = 25 the swipe never lands on.
		const stroke: InkStroke = {
			id: 'ink-1',
			pageId: 'p1',
			tool: 'pen',
			color: '#202020',
			width: 2,
			points: [25, 40, 0.5, 25, 60, 0.5],
		};
		ink.strokes = [stroke];
		ink.tool = 'eraser';
		document.body.append(ink);
		await ink.updateComplete;
		const erased: string[][] = [];
		ink.addEventListener('nb-erase', (e) =>
			erased.push((e as CustomEvent<{ ids: string[] }>).detail.ids),
		);
		const svg = ink.shadowRoot!.querySelector('svg')!;
		svg.dispatchEvent(pointer('pointerdown', 0, 0));
		// Dispatched at (100, 0), passing through (50, 100) on the way: the way crosses the stroke.
		const move = pointer('pointermove', 100, 0);
		Object.defineProperty(move, 'getCoalescedEvents', {
			value: () => [pointer('pointermove', 50, 100), pointer('pointermove', 100, 0)],
		});
		svg.dispatchEvent(move);
		svg.dispatchEvent(pointer('pointerup', 100, 0));
		expect(erased).toEqual([['ink-1']]);
		ink.remove();
	});
});
