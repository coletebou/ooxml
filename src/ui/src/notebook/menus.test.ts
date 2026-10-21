import type { NotebookState } from 'ooxml-core/notebook';
import { pageNeighbour } from './menus';

describe('page menu neighbours', () => {
	it('moves a subpage only among its siblings', () => {
		const page = (id: string, level: number) => ({ id, level });
		const state = {
			pages: [page('A', 0), page('A1', 1), page('A2', 1), page('B', 0), page('B1', 1)],
		} as unknown as NotebookState;
		expect(pageNeighbour(state, 'A1', -1)).toBeNull();
		expect(pageNeighbour(state, 'A2', 1)).toBeNull();
		expect(pageNeighbour(state, 'A2', -1)).toBe('A1');
		expect(pageNeighbour(state, 'A', 1)).toBeUndefined();
		expect(pageNeighbour(state, 'B', -1)).toBe('A');
	});
});
