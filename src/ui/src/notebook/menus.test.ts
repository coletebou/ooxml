import type { NotebookState } from 'ooxml-core/notebook';
import { type MenuContext, notebookMenu, pageNeighbour } from './menus';

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

describe('notebook menu', () => {
	it('leaves no rejection unhandled when opening or deleting a notebook fails', async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);
		try {
			const fail = () => Promise.reject(new Error('device gone'));
			const context = {
				client: { openNotebook: fail, deleteNotebook: fail },
				state: {
					notebookId: 'n1',
					notebook: { name: 'One', color: '#3366cc' },
					notebooks: [{ id: 'n1', name: 'One', color: '#3366cc', deleted: 0 }],
				},
				t: (key: string) => key,
				rename: () => undefined,
				deleted: () => undefined,
			} as unknown as MenuContext;
			const noop = () => undefined;
			const menu = notebookMenu(context, {
				new: noop,
				import: noop,
				exportPage: noop,
				exportNotebook: noop,
			});
			menu.run('open:n2');
			menu.run('delete');
			await new Promise((r) => setTimeout(r, 20));
			expect(unhandled).toEqual([]);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});
});
