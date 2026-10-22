import { applyNotebookProps } from './bind';
import type { NotebookApp } from './notebook-app';

describe('applyNotebookProps', () => {
	it('writes changed props only and goes back to local mode when the config is removed', () => {
		const el = {
			userName: '',
			locale: '',
			theme: 'system',
			config: null,
		} as unknown as NotebookApp;
		const server = { mode: 'server' as const, syncUrl: 'wss://sync.example' };
		applyNotebookProps(el, { userName: 'Ada', config: server });
		expect(el.userName).toBe('Ada');
		expect(el.config).toEqual(server);
		applyNotebookProps(el, { userName: 'Ada' }, { userName: 'Ada', config: server });
		expect(el.config).toBeNull();
		el.userName = 'changed elsewhere';
		applyNotebookProps(el, { userName: 'Ada' }, { userName: 'Ada' });
		expect(el.userName).toBe('changed elsewhere');
	});
});
