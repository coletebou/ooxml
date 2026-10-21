// The contract every notebook UI binds to: one immutable `NotebookState` snapshot and plain action
// functions, in the `getState` / `subscribe` shape React (`useSyncExternalStore`), Vue, Solid,
// Svelte and Angular adopt in a few lines. New code.
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { BroadcastChannelConstructor } from '../collab/broadcast-transport';
import type { Emitter } from '../collab/emitter';
import type { ConnectionStatus } from '../collab/provider';
import type { WebSocketConstructor } from '../collab/websocket-transport';
import type { PageExportOptions, PageExportReport } from './docx-export';
import type { Container, InkStroke, NotebookEntry, PageLevel, SectionKind } from './model';
import type { NotebookMeta } from './read';
import type { RichNode } from './rich-text';
import type { NotebookStorage } from './storage';
import type { NotebookSyncConfig } from './sync';
import type { SearchHit, TodoItem } from './text-index';
import type { PageView, PeerView, SectionView } from './views';

export interface NotebookClientOptions {
	user: { id?: string; name: string; color?: string };
	/** Where documents live on this device. Without it nothing survives a reload. */
	storage?: NotebookStorage;
	config?: NotebookSyncConfig | null;
	/** Keeps the notebook list of one profile apart from another's (a suite profile id). */
	scope?: string;
	/** Create a notebook on first run (default true). */
	createDefault?: boolean;
	/** Names of new items, in the UI's language. */
	names?: Partial<Record<'notebook' | 'section' | 'group', string>>;
	now?: () => number;
	saveDelayMs?: number;
	WebSocket?: WebSocketConstructor;
	BroadcastChannel?: BroadcastChannelConstructor;
}

export interface NotebookState {
	/** The notebook list has been loaded. */
	ready: boolean;
	/** A notebook is being opened. */
	loading: boolean;
	status: ConnectionStatus | 'closed';
	mode: 'local' | 'server';
	user: { id: string; name: string; color: string };
	notebooks: NotebookEntry[];
	notebookId: string;
	notebook: (NotebookMeta & { id: string }) | null;
	/** Visible sections and groups in display order. */
	sections: SectionView[];
	sectionId: string;
	section: SectionView | null;
	pages: PageView[];
	pageId: string;
	page: PageView | null;
	/** The selected page's containers, bottom to top, and its ink, oldest first. */
	containers: Container[];
	strokes: InkStroke[];
	/** Who else has this notebook open, and where. */
	peers: PeerView[];
	canUndo: boolean;
	canRedo: boolean;
	searchQuery: string;
	searchResults: SearchHit[];
	/** Every to-do tag in the notebook, in section and page order. */
	todos: TodoItem[];
}

export type NotebookNoticeCode =
	| 'save-failed'
	| 'open-failed'
	| 'file-too-large'
	| 'import-failed'
	| 'export-failed'
	| 'sync-error';

export interface NotebookEvents {
	notice: { code: NotebookNoticeCode; detail?: string };
}

/** What the rich-text editor binds to (through y-prosemirror). The one place a UI meets Yjs. */
export interface TextBinding {
	fragment: Y.XmlFragment;
	undo: Y.UndoManager;
	awareness: Awareness;
	user: { name: string; color: string };
}

export interface ExportedFile {
	bytes: Uint8Array;
	fileName: string;
	mime: string;
}

export interface NotebookClient {
	getState: () => NotebookState;
	/** Called after every state change (coalesced per microtask); returns the unsubscribe. */
	subscribe: (listener: () => void) => () => void;
	on: Emitter<NotebookEvents>['on'];
	/** Resolves once the notebook list is loaded and a notebook (if any) is open. */
	whenReady: () => Promise<void>;

	createNotebook: (input?: { name?: string; color?: string }) => Promise<string>;
	openNotebook: (id: string) => Promise<void>;
	renameNotebook: (id: string, name: string) => void;
	setNotebookColor: (id: string, color: string) => void;
	moveNotebook: (id: string, beforeId?: string) => void;
	/** Moves a notebook to the device's recycle bin; `restoreNotebook` brings it back. */
	deleteNotebook: (id: string) => Promise<void>;
	restoreNotebook: (id: string) => Promise<void>;

	createSection: (input?: {
		name?: string;
		color?: string;
		parentId?: string;
		kind?: SectionKind;
	}) => string;
	selectSection: (id: string) => void;
	renameSection: (id: string, name: string) => void;
	setSectionColor: (id: string, color: string) => void;
	moveSection: (id: string, target: { parentId: string; beforeId?: string }) => void;
	/** Returns a trash batch for `restore`. */
	deleteSection: (id: string) => string | null;

	createPage: (input?: {
		afterId?: string;
		subpage?: boolean;
		title?: string;
		sectionId?: string;
	}) => string;
	selectPage: (id: string) => void;
	renamePage: (id: string, title: string) => void;
	movePage: (id: string, target: { sectionId: string; beforeId?: string }) => void;
	/** Make a page a subpage (+1) or promote it (-1). */
	indentPage: (id: string, delta: 1 | -1) => void;
	deletePage: (id: string) => string | null;
	restore: (batch: string) => void;

	addText: (at: { x: number; y: number; width?: number }, content?: readonly RichNode[]) => string;
	addImage: (input: BinaryItemInput) => string;
	addFile: (input: BinaryItemInput) => string;
	moveContainers: (ids: readonly string[], dx: number, dy: number) => void;
	resizeContainer: (id: string, size: { width: number; height?: number }) => void;
	bringToFront: (id: string) => void;
	deleteContainers: (ids: readonly string[]) => void;
	addStroke: (input: {
		tool: 'pen' | 'highlighter';
		color: string;
		width: number;
		points: readonly number[];
	}) => string;
	eraseStrokes: (ids: readonly string[]) => void;
	containerBytes: (id: string) => Uint8Array | null;
	textBinding: (containerId: string) => TextBinding | null;
	/** Tell collaborators which container you are in (or `null`). */
	focusContainer: (id: string | null) => void;
	setTodo: (item: Pick<TodoItem, 'containerId' | 'index' | 'text'>, done: boolean) => void;

	undo: () => void;
	redo: () => void;
	search: (query: string) => void;

	exportPage: (
		pageId?: string,
		options?: PageExportOptions & { subtitle?: string; untitled?: string },
	) => Promise<ExportedFile & { report: PageExportReport }>;
	exportNotebook: () => Promise<ExportedFile>;
	importNotebook: (bytes: Uint8Array) => Promise<string>;

	/** Save everything now (call before the page unloads). */
	flush: () => Promise<void>;
	destroy: () => Promise<void>;
}

export interface BinaryItemInput {
	x: number;
	y: number;
	width: number;
	height: number;
	name: string;
	mime: string;
	bytes: Uint8Array;
	alt?: string;
}

export type { PageLevel };
