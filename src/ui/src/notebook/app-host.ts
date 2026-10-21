// What the app's actions need from <notebook-app>: the client and its state, the UI state they
// change (tool, zoom, panes), translation, notices, menus and the parts on screen. NotebookApp
// implements it; the action modules stay plain functions over it.
import type { NotebookClient, NotebookState } from 'ooxml-core/notebook';
import type { MessageParams } from 'ooxml-core/i18n';
import type { EditorView } from 'prosemirror-view';
import type { NotebookKey, NotebookPluralKey } from './i18n/translator';
import type { LinkDialogValue } from './link-dialog';
import type { MenuSpec } from './menus';
import type { NavItemKind, NotebookNav } from './nav-pane';
import type { NotebookPage, NotebookTool } from './page-canvas';

export interface AppHost {
	readonly client: NotebookClient | null;
	readonly state: NotebookState | null;
	readonly locale: string;
	/** The last text container the person was in (ribbon formatting applies to it). */
	editor: EditorView | null;
	tool: NotebookTool;
	zoom: number;
	navOpen: boolean;
	todosOpen: boolean;
	strokeWidth: number;
	penColor: string;
	highlighterColor: string;
	link: LinkDialogValue | null;
	focusId: string;
	readonly updateComplete: Promise<boolean>;
	tr: (key: NotebookKey, params?: MessageParams) => string;
	trn: (key: NotebookPluralKey, count: number, params?: MessageParams) => string;
	notify: (message: string, undo?: () => void) => void;
	noticeDeleted: (kind: NavItemKind, batch: string | null, id: string) => void;
	openMenu: (spec: MenuSpec | null, x: number, y: number) => void;
	page: () => NotebookPage | null;
	nav: () => NotebookNav | null;
	/** Open one of the hidden file pickers. */
	pick: (kind: 'picture' | 'file' | 'archive') => void;
	/** Dispatch a bubbling, composed event from the app; false when a listener cancelled it. */
	emit: <T>(type: string, detail: T, cancelable?: boolean) => boolean;
}
