import { describe, expect, it, vi } from 'vitest';
import {
	bindNotebook,
	defineNotebookApp,
	pickNotebookProps,
	type NotebookApp,
	type NotebookExportDetail,
	type NotebookOpenFileDetail,
	type NotebookProps,
} from './index';

function element(): NotebookApp {
	defineNotebookApp();
	return document.createElement('notebook-app') as NotebookApp;
}

type DataProps = Omit<NotebookProps, 'onReady' | 'onNavigate' | 'onOpenFile' | 'onExport'>;

describe('pickNotebookProps', () => {
	it('keeps provided values, an explicit null config, and drops undefined and handlers', () => {
		expect(
			pickNotebookProps({
				storageName: 'notes',
				userName: undefined,
				config: null,
				className: 'a b',
			}),
		).toEqual({ storageName: 'notes', config: null, className: 'a b' });
		expect(pickNotebookProps({ className: '' })).toEqual({});
	});

	it('copies every data prop of NotebookProps and no handler', () => {
		// `Required` makes this object fail to compile when NotebookProps gains a data prop, and the
		// assertion fails until pickNotebookProps copies it.
		const every: Required<DataProps> = {
			userName: 'Ada',
			userId: 'u-ada',
			locale: 'de',
			config: { mode: 'server', syncUrl: 'wss://notes.example.com/sync' },
			storageName: 'notes',
			theme: 'dark',
		};
		const withHandlers: NotebookProps = {
			...every,
			onReady: vi.fn(),
			onNavigate: vi.fn(),
			onOpenFile: vi.fn(),
			onExport: vi.fn(),
		};
		expect(pickNotebookProps(withHandlers)).toEqual(every);
	});
});

describe('bindNotebook', () => {
	it('applies props, swaps the host class list and re-applies only what changed', () => {
		const el = element();
		const binding = bindNotebook(el, () => ({}));
		binding.update({ userName: 'Ada', storageName: 'notes', theme: 'dark', className: 'one two' });
		expect(el.userName).toBe('Ada');
		expect(el.storageName).toBe('notes');
		expect(el.theme).toBe('dark');
		expect(el.className).toBe('one two');
		el.userName = 'edited in the element';
		binding.update({
			userName: 'Ada',
			storageName: 'notes',
			theme: 'dark',
			className: 'two three',
		});
		expect(el.userName).toBe('edited in the element');
		expect([...el.classList]).toEqual(['two', 'three']);
		binding.update({ userName: 'Ada' });
		expect(el.storageName).toBe('');
		expect(el.theme).toBe('system');
		expect(el.classList.length).toBe(0);
		binding.destroy();
	});

	it('passes the sync config through and keeps an explicit null', () => {
		const el = element();
		const binding = bindNotebook(el, () => ({}));
		const server = { mode: 'server', syncUrl: 'wss://notes.example.com/sync' } as const;
		binding.update({ config: server });
		expect(el.config).toBe(server);
		binding.update({ config: null });
		expect(el.config).toBeNull();
		binding.destroy();
	});

	it('calls the latest handlers for every event, with the event for the cancelable ones', () => {
		const el = element();
		const first = vi.fn();
		const latest = {
			onReady: vi.fn(),
			onNavigate: vi.fn(),
			onOpenFile: vi.fn(),
			onExport: vi.fn(),
		};
		let handlers: NotebookProps = { onReady: first };
		const binding = bindNotebook(el, () => handlers);
		handlers = latest;
		const ready = { user: { id: 'u-ada', name: 'Ada' } };
		const navigated = { notebookId: 'n1', sectionId: 's1', pageId: 'p1' };
		const file: NotebookOpenFileDetail = {
			name: 'plan.xlsx',
			mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			kind: 'xlsx',
			bytes: new Uint8Array([1, 2]),
		};
		const exported: NotebookExportDetail = {
			fileName: 'Plans.docx',
			mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			bytes: new Uint8Array([3]),
			kind: 'docx',
		};
		const open = new CustomEvent('notebook-open-file', { detail: file, cancelable: true });
		const save = new CustomEvent('notebook-export', { detail: exported, cancelable: true });
		el.dispatchEvent(new CustomEvent('notebook-ready', { detail: ready }));
		el.dispatchEvent(new CustomEvent('notebook-navigate', { detail: navigated }));
		el.dispatchEvent(open);
		el.dispatchEvent(save);
		expect(first).not.toHaveBeenCalled();
		expect(latest.onReady).toHaveBeenCalledWith(ready);
		expect(latest.onNavigate).toHaveBeenCalledWith(navigated);
		expect(latest.onOpenFile).toHaveBeenCalledWith(file, open);
		expect(latest.onExport).toHaveBeenCalledWith(exported, save);
		binding.destroy();
		el.dispatchEvent(new CustomEvent('notebook-ready', { detail: ready }));
		el.dispatchEvent(new CustomEvent('notebook-navigate', { detail: navigated }));
		expect(latest.onReady).toHaveBeenCalledOnce();
		expect(latest.onNavigate).toHaveBeenCalledOnce();
	});

	it('lets a handler cancel opening a file or saving an export to take it over', () => {
		const el = element();
		const binding = bindNotebook(el, () => ({
			onOpenFile: (_detail, event) => event.preventDefault(),
			onExport: (detail, event) => {
				if (detail.kind === 'archive') event.preventDefault();
			},
		}));
		const open = new CustomEvent('notebook-open-file', {
			detail: { name: 'a.docx', mime: '', kind: 'docx', bytes: new Uint8Array() },
			cancelable: true,
		});
		expect(el.dispatchEvent(open)).toBe(false);
		const archive = { fileName: 'a.zip', mime: 'application/zip', bytes: new Uint8Array() };
		const kept = new CustomEvent('notebook-export', {
			detail: { ...archive, kind: 'archive' },
			cancelable: true,
		});
		const passed = new CustomEvent('notebook-export', {
			detail: { ...archive, kind: 'file' },
			cancelable: true,
		});
		expect(el.dispatchEvent(kept)).toBe(false);
		expect(el.dispatchEvent(passed)).toBe(true);
		binding.destroy();
	});
});

describe('locale', () => {
	it('is a shared prop: picked from the framework, applied to the element and reset when removed', () => {
		expect(pickNotebookProps({ locale: 'de', userName: undefined })).toEqual({ locale: 'de' });
		const el = element();
		const binding = bindNotebook(el, () => ({}));
		binding.update({ locale: 'de' });
		expect(el.locale).toBe('de');
		binding.update({ locale: 'zh-CN' });
		expect(el.locale).toBe('zh-CN');
		binding.update({});
		expect(el.locale).toBe('');
		binding.destroy();
	});
});
