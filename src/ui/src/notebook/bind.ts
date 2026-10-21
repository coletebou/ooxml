// The contract every framework binding implements: the same props in, the same events out. The
// bindings are lifecycle adapters only (create the element, forward props, re-emit events);
// behaviour lives in <notebook-app>. Each binding also ships raw hooks over the core client
// (`store.ts`) for apps that render their own UI.
import type { NotebookSyncConfig } from 'ooxml-core/notebook';
import type {
	NotebookApp,
	NotebookExportDetail,
	NotebookNavigateDetail,
	NotebookOpenFileDetail,
	NotebookTheme,
} from './notebook-app';

export interface NotebookProps {
	userName?: string;
	/** Stable id for presence; defaults to one remembered in this browser. */
	userId?: string;
	/** Display language: `en`, `de`, `es`, `fr` or `zh-CN` (any BCP 47 tag maps to one; else English). */
	locale?: string;
	/** Sync settings. Omit (or `null`) for local mode: tabs of this browser share notebooks. */
	config?: NotebookSyncConfig | null;
	/** IndexedDB database for this profile's notebooks. Default `ooxml-notebooks`. */
	storageName?: string;
	/** `system` (default) follows the page, `light` or `dark` force one. */
	theme?: NotebookTheme;
	onReady?: (detail: { user: { id: string; name: string } }) => void;
	/** The open notebook, section or page changed. */
	onNavigate?: (detail: NotebookNavigateDetail) => void;
	/** Cancel the event (`preventDefault`) to open an embedded file yourself (default: download). */
	onOpenFile?: (detail: NotebookOpenFileDetail, event: CustomEvent<NotebookOpenFileDetail>) => void;
	/** Cancel the event to save an export yourself (default: download). */
	onExport?: (detail: NotebookExportDetail, event: CustomEvent<NotebookExportDetail>) => void;
}

const SCALARS = ['userName', 'userId', 'locale', 'storageName', 'theme'] as const;

/** Push props onto the element. Only changed values are written, so frameworks can call it freely. */
export function applyNotebookProps(
	el: NotebookApp,
	props: NotebookProps,
	prev: NotebookProps = {},
): void {
	for (const key of SCALARS) {
		if (props[key] === prev[key]) continue;
		if (key === 'theme') el.theme = props.theme ?? 'system';
		else el[key] = props[key] ?? '';
	}
	if (props.config !== prev.config && props.config !== undefined) el.config = props.config;
}

/** Subscribe to the element's events; the latest handlers are read through `get`. */
export function listenNotebookEvents(el: NotebookApp, get: () => NotebookProps): () => void {
	const ready = (e: Event): void => get().onReady?.((e as CustomEvent).detail);
	const navigate = (e: Event): void => get().onNavigate?.((e as CustomEvent).detail);
	const open = (e: Event): void => {
		const event = e as CustomEvent<NotebookOpenFileDetail>;
		get().onOpenFile?.(event.detail, event);
	};
	const exported = (e: Event): void => {
		const event = e as CustomEvent<NotebookExportDetail>;
		get().onExport?.(event.detail, event);
	};
	el.addEventListener('notebook-ready', ready);
	el.addEventListener('notebook-navigate', navigate);
	el.addEventListener('notebook-open-file', open);
	el.addEventListener('notebook-export', exported);
	return () => {
		el.removeEventListener('notebook-ready', ready);
		el.removeEventListener('notebook-navigate', navigate);
		el.removeEventListener('notebook-open-file', open);
		el.removeEventListener('notebook-export', exported);
	};
}
