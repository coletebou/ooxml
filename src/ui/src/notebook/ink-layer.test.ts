import type { InkStroke } from 'ooxml-core/notebook';
import { type NotebookInk, defineNotebookInk } from './ink-layer';

const pointer = (type: string, x: number, y: number, pointerId = 1, pointerType = 'mouse') =>
	new PointerEvent(type, {
		bubbles: true,
		button: 0,
		pointerId,
		pointerType,
		clientX: x,
		clientY: y,
	});

async function layer(tool: NotebookInk['tool'], strokes: InkStroke[] = []): Promise<NotebookInk> {
	defineNotebookInk();
	const ink = document.createElement('notebook-ink') as NotebookInk;
	ink.strokes = strokes;
	ink.tool = tool;
	document.body.append(ink);
	await ink.updateComplete;
	return ink;
}

const upright: InkStroke = {
	id: 'ink-1',
	pageId: 'p1',
	tool: 'pen',
	color: '#202020',
	width: 2,
	points: [25, 40, 0.5, 25, 60, 0.5],
};

describe('<notebook-ink> eraser', () => {
	it('erases what a fast swipe crosses between the positions it reports', async () => {
		// A short upright stroke at x = 25 the swipe never lands on.
		const ink = await layer('eraser', [upright]);
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

	it('erases on the way from the last move to where it is lifted', async () => {
		const ink = await layer('eraser', [upright]);
		const erased: string[][] = [];
		ink.addEventListener('nb-erase', (e) =>
			erased.push((e as CustomEvent<{ ids: string[] }>).detail.ids),
		);
		const svg = ink.shadowRoot!.querySelector('svg')!;
		svg.dispatchEvent(pointer('pointerdown', 0, 50));
		svg.dispatchEvent(pointer('pointermove', 10, 50));
		svg.dispatchEvent(pointer('pointerup', 50, 50));
		expect(erased).toEqual([['ink-1']]);
		ink.remove();
	});
});

describe('<notebook-ink> pen', () => {
	it('keeps the stroke when another contact, such as a palm, is cancelled', async () => {
		const ink = await layer('pen');
		const strokes: unknown[] = [];
		ink.addEventListener('nb-stroke', (e) => strokes.push((e as CustomEvent).detail));
		const svg = ink.shadowRoot!.querySelector('svg')!;
		svg.dispatchEvent(pointer('pointerdown', 10, 10, 1, 'pen'));
		svg.dispatchEvent(pointer('pointermove', 30, 30, 1, 'pen'));
		svg.dispatchEvent(pointer('pointercancel', 80, 80, 2, 'touch'));
		svg.dispatchEvent(pointer('pointermove', 50, 40, 1, 'pen'));
		svg.dispatchEvent(pointer('pointerup', 50, 40, 1, 'pen'));
		expect(strokes).toHaveLength(1);
		ink.remove();
	});

	it('ends the stroke where it is lifted, at the pressure it had', async () => {
		const ink = await layer('pen');
		const strokes: { points: number[] }[] = [];
		ink.addEventListener('nb-stroke', (e) => strokes.push((e as CustomEvent).detail));
		const svg = ink.shadowRoot!.querySelector('svg')!;
		const pen = (type: string, x: number, y: number, pressure: number) =>
			new PointerEvent(type, {
				bubbles: true,
				button: 0,
				pointerId: 1,
				pointerType: 'pen',
				clientX: x,
				clientY: y,
				pressure,
			});
		svg.dispatchEvent(pen('pointerdown', 10, 10, 0.3));
		svg.dispatchEvent(pen('pointermove', 20, 10, 0.3));
		svg.dispatchEvent(pen('pointerup', 40, 10, 0));
		expect(strokes[0]?.points).toEqual([10, 10, 0.3, 20, 10, 0.3, 40, 10, 0.3]);
		ink.remove();
	});
});
