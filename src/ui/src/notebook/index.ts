// `ooxml-ui/notebook`: the notebook app. `<notebook-app>` composes the navigation pane, the page
// canvas (text containers on ProseMirror, pictures, embedded Office files, ink) and the To Do pane
// over the core client (`ooxml-core/notebook`). Importing this entry never touches the DOM;
// `defineNotebookApp()` registers the elements.
export { NotebookApp, defineNotebookApp, HIGHLIGHTER_COLORS, PEN_COLORS } from './notebook-app';
export type {
	NotebookExportDetail,
	NotebookNavigateDetail,
	NotebookOpenFileDetail,
	NotebookTheme,
} from './notebook-app';
export { NotebookNav, defineNotebookNav } from './nav-pane';
export { NotebookPage, defineNotebookPage, type NotebookTool } from './page-canvas';
export { NotebookText, defineNotebookText } from './text-container';
export { NotebookInk, defineNotebookInk } from './ink-layer';
export { NotebookFile, defineNotebookFile } from './file-embed';
export { NotebookTodos, defineNotebookTodos } from './todo-pane';
export { NotebookLinkDialog, defineNotebookLinkDialog } from './link-dialog';
export { applyNotebookProps, listenNotebookEvents, type NotebookProps } from './bind';
export * from './store';
export {
	createIndexedDbStorage,
	DEFAULT_NOTEBOOK_DATABASE,
	type IndexedDbStorage,
} from './storage';
export { rasterize } from './raster';
export {
	NOTEBOOK_LOCALES,
	NOTEBOOK_MESSAGES,
	normalizeNotebookLocale,
	notebookI18n,
	type NotebookI18n,
	type NotebookKey,
} from './i18n/translator';
