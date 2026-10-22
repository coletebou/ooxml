// <notebook-app>: the notebook application. All notebook logic lives in `createNotebookClient`
// (ooxml-core/notebook); the parts are the navigation pane, the page canvas and the To Do pane.
// This element owns the client's lifecycle, the ribbon, menus, notices and dialogs, and routes
// commands (`app-actions.ts`, `app-nav.ts`).
import { html, nothing, unsafeCSS } from 'lit';
import type { MessageParams } from 'ooxml-core/i18n';
import {
	type NotebookClient,
	type NotebookState,
	type NotebookSyncConfig,
	parseSyncConfig,
} from 'ooxml-core/notebook';
import { type ActiveFormats, activeFormats } from 'ooxml-core/notebook/editor';
import type { EditorView } from 'prosemirror-view';
import { controlStyles } from '../base';
import { readOfficeProfile } from '../chrome/account-profile';
import { registerControls } from '../controls';
import { attachKeyTips, type KeyTipsHandle } from '../keytips';
import type { OfficeMenuState } from '../menu/menu-model';
import { definePresence } from '../presence';
import { definer } from '../registry';
import { installOfficeUiTheme, THEME_CSS } from '../theme';
import type { AppHost } from './app-host';
import {
	appKeys,
	applyLink,
	importArchive,
	openEmbedded,
	runCommand,
	setInkColor,
} from './app-actions';
import {
	deleteItem,
	dropItem,
	go,
	itemMenu,
	menuContext,
	moveItem,
	notebookMenuAt,
	renameItem,
} from './app-nav';
import { NotebookElement } from './base';
import type { NotebookKey, NotebookPluralKey } from './i18n/translator';
import { defineNotebookLinkDialog, type LinkDialogValue } from './link-dialog';
import { containerMenu, type MenuSpec } from './menus';
import { type NavItemKind, type NotebookNav, defineNotebookNav } from './nav-pane';
import { type NotebookPage, type NotebookTool, defineNotebookPage } from './page-canvas';
import {
	COMMAND_KEYTIPS,
	ICON_ONLY,
	RIBBON_TABS,
	type RibbonTab,
	TAB_KEYTIPS,
	ribbonGroups,
} from './ribbon';
import { createNotebook, notebookNames } from './store';
import { defineNotebookTodos } from './todo-pane';
import css from './notebook-app.css?raw';
import { registerNotebookIcons } from './icons';

export type NotebookTheme = 'system' | 'light' | 'dark';
export interface NotebookNavigateDetail {
	notebookId: string;
	sectionId: string;
	pageId: string;
}
export interface NotebookOpenFileDetail {
	/** The container on the page: stable while the file stays there. */
	id: string;
	name: string;
	mime: string;
	kind: 'docx' | 'xlsx' | 'pptx' | 'vsdx' | 'other';
	bytes: Uint8Array;
}
export interface NotebookExportDetail {
	fileName: string;
	mime: string;
	bytes: Uint8Array;
	kind: 'docx' | 'archive' | 'file';
}

const LOCAL_THEME = THEME_CSS.replaceAll(
	':root[data-office-theme="dark"]',
	':host([data-office-theme="dark"])',
)
	.replaceAll(':root:not([data-office-theme="light"])', ':host([data-office-theme="system"])')
	.replaceAll(':root', ':host([data-office-theme])');

export const PEN_COLORS = [
	{ name: 'black', value: '#202020' },
	{ name: 'blue', value: '#2f5ec4' },
	{ name: 'red', value: '#d13438' },
	{ name: 'green', value: '#2e8540' },
	{ name: 'purple', value: '#7a4cc2' },
	{ name: 'orange', value: '#d46b08' },
] as const;
export const HIGHLIGHTER_COLORS = [
	{ name: 'yellow', value: '#f7e43a' },
	{ name: 'green', value: '#8be04e' },
	{ name: 'cyan', value: '#5fd3f3' },
	{ name: 'magenta', value: '#f27ad2' },
] as const;

export class NotebookApp extends NotebookElement implements AppHost {
	static override styles = [unsafeCSS(LOCAL_THEME), ...controlStyles(css)];
	static override properties = {
		userName: { type: String, attribute: 'user-name' },
		userId: { type: String, attribute: 'user-id' },
		storageName: { type: String, attribute: 'storage-name' },
		theme: { type: String },
		serverConfig: { type: String, attribute: 'server-config' },
		config: { attribute: false },
		state: { state: true },
		tool: { state: true },
		penColor: { state: true },
		highlighterColor: { state: true },
		strokeWidth: { state: true },
		zoom: { state: true },
		navOpen: { state: true },
		todosOpen: { state: true },
		formats: { state: true },
		menu: { state: true },
		notice: { state: true },
		link: { state: true },
		focusId: { state: true },
	};
	declare userName: string;
	declare userId: string;
	declare storageName: string;
	declare theme: NotebookTheme;
	/** The sync settings as JSON, for plain markup (`server-config='{"mode":"server",...}'`). */
	declare serverConfig: string;
	declare config: NotebookSyncConfig | null;
	declare state: NotebookState | null;
	declare tool: NotebookTool;
	declare penColor: string;
	declare highlighterColor: string;
	declare strokeWidth: number;
	declare zoom: number;
	declare navOpen: boolean;
	declare todosOpen: boolean;
	declare formats: ActiveFormats | null;
	declare menu: (OfficeMenuState & { spec: MenuSpec }) | null;
	declare notice: { message: string; undo?: () => unknown } | null;
	declare link: LinkDialogValue | null;
	declare focusId: string;
	editor: EditorView | null = null;
	#client: NotebookClient | null = null;
	#clientKey = '';
	#off: (() => void)[] = [];
	#keytips: KeyTipsHandle | null = null;
	#noticeTimer: ReturnType<typeof setTimeout> | undefined;
	#lastNav = '';
	/** The container of `editor`: only it sets the ribbon's formats. */
	#editorId = '';
	/** The storage the current client was made for. */
	#storageName = '';

	constructor() {
		super();
		this.userName = '';
		this.userId = '';
		this.storageName = '';
		this.theme = 'system';
		this.serverConfig = '';
		this.config = null;
		this.state = null;
		this.tool = 'type';
		this.penColor = PEN_COLORS[0].value;
		this.highlighterColor = HIGHLIGHTER_COLORS[0].value;
		this.strokeWidth = 2.5;
		this.zoom = 1;
		this.navOpen = true;
		this.todosOpen = false;
		this.formats = null;
		this.menu = null;
		this.notice = null;
		this.link = null;
		this.focusId = '';
	}

	/**
	 * The core client of the notebooks on screen (for hosts and tests); `null` while none are, such
	 * as during a switch to another profile, while the old one still saves its last changes.
	 */
	get client(): NotebookClient | null {
		return this.#clientKey ? this.#client : null;
	}

	tr = (key: NotebookKey, params?: MessageParams): string => this.t(key, params);
	trn = (key: NotebookPluralKey, count: number, params?: MessageParams): string =>
		this.tn(key, count, params);
	emit = <T>(type: string, detail: T, cancelable = false): boolean =>
		this.fire(type, detail, cancelable);
	page = (): NotebookPage | null => this.renderRoot.querySelector('notebook-page');
	nav = (): NotebookNav | null => this.renderRoot.querySelector('notebook-nav');
	pick = (kind: 'picture' | 'file' | 'archive'): void =>
		this.renderRoot.querySelector<HTMLInputElement>(`input[data-pick="${kind}"]`)?.click();

	notify = (message: string, undo?: () => unknown): void => {
		clearTimeout(this.#noticeTimer);
		this.notice = undo ? { message, undo } : { message };
		this.#noticeTimer = setTimeout(() => (this.notice = null), 8000);
	};

	/** After a delete: what went, with Undo. */
	noticeDeleted = (kind: NavItemKind, batch: string | null, id: string): void => {
		const client = this.#client;
		if (!client) return;
		// Undo restores in the notebook the delete happened in, even after switching to another.
		const source = this.state?.notebookId ?? '';
		const undo =
			kind === 'notebook'
				? () => client.restoreNotebook(id).catch(() => this.notify(this.t('notice.open-failed')))
				: batch
					? async () => {
							try {
								if (client.getState().notebookId !== source) await client.openNotebook(source);
								client.restore(batch);
							} catch {
								this.notify(this.t('notice.open-failed'));
							}
						}
					: undefined;
		const key =
			kind === 'page'
				? 'notice.page'
				: kind === 'group'
					? 'notice.group'
					: kind === 'notebook'
						? 'notice.notebook'
						: 'notice.section';
		this.notify(this.t(key), undo);
	};

	openMenu = (spec: MenuSpec | null, x: number, y: number): void => {
		this.menu = spec ? { x, y, label: spec.label, items: spec.items, spec } : null;
	};

	override connectedCallback(): void {
		super.connectedCallback();
		installOfficeUiTheme();
		// Moved in the DOM (removed and attached again): the client was released; start a new one,
		// and give the ribbon its KeyTips again (firstUpdated only runs once).
		if (!this.#client) this.requestUpdate();
		if (this.hasUpdated && !this.#keytips)
			this.#keytips = attachKeyTips(this.renderRoot as ShadowRoot);
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		this.#keytips?.dispose();
		this.#keytips = null;
		clearTimeout(this.#noticeTimer);
		this.#stop();
	}

	#config(): NotebookSyncConfig {
		if (this.config) return this.config;
		if (!this.serverConfig) return { mode: 'local' };
		try {
			return parseSyncConfig(JSON.parse(this.serverConfig)).config;
		} catch {
			return { mode: 'local' };
		}
	}

	/**
	 * A new client for changed props (user, storage, sync settings). The current one saves its last
	 * changes first; when the device refuses them it stays, so they are not lost with it (save-failed
	 * says why) and the change applies once saving works.
	 */
	#restart(): void {
		const current = this.#client;
		if (!current) return this.#start();
		// Equal settings (a host passing a fresh but equal config object) keep the client.
		if (this.#key() === this.#clientKey) return;
		// Another storage is another profile: its notebooks must not stay on screen, so it switches
		// even when the last save failed (the save-failed notice said so).
		const profile = this.storageName !== this.#storageName;
		if (profile) {
			// Off the screen at once (menus, dialogs and notices too): its notebooks are not shown
			// while its last save completes.
			this.#hide();
			// No longer shown, so a switch straight back to this profile starts a client to show it.
			this.#clientKey = '';
		}
		// The new client starts either way: a host that turns the sync server off, or switches the
		// profile, must not keep the old one. What the device refused is kept in the tab and saved by
		// the next client on that storage; the notice says it was not saved.
		void current.flush().then(
			() => this.#client === current && this.#start(),
			async () => {
				if (this.#client !== current) return;
				// The old client keeps a copy of what it could not save once it is closed; the new one
				// starts after that, so it opens the notebook with those changes.
				for (const off of this.#off.splice(0)) off();
				await current.destroy();
				if (this.#client !== current) return;
				// The closed client is no longer the app's, so the next one starts even for equal settings.
				this.#client = null;
				this.#clientKey = '';
				this.#start();
				this.notify(this.t('notice.save-failed'));
			},
		);
	}

	/** The settings a client is made from, compared to tell whether a new one is needed. */
	#key(): string {
		const name = this.userName || readOfficeProfile().displayName || 'Guest';
		return JSON.stringify([this.userId, name, this.storageName, this.#config()]);
	}

	#start(): void {
		const config = this.#config();
		const profile = readOfficeProfile();
		const name = this.userName || profile.displayName || 'Guest';
		const key = this.#key();
		if (key === this.#clientKey && this.#client) return;
		this.#stop();
		this.#clientKey = key;
		this.#storageName = this.storageName;
		const client = createNotebook({
			user: {
				...(this.userId ? { id: this.userId } : {}),
				name,
				...(profile.avatarColor ? { color: profile.avatarColor } : {}),
			},
			config,
			locale: this.locale,
			...(this.storageName ? { storageName: this.storageName } : {}),
		});
		this.#client = client;
		this.#off.push(
			client.subscribe(() => this.#onState(client)),
			client.on('notice', ({ code }) => this.notify(this.t(`notice.${code}`))),
		);
		void client.whenReady().then(() => {
			// Not if it was taken off the screen meanwhile (a switch to another profile).
			if (this.#client !== client || this.#clientKey !== key) return;
			this.#onState(client);
			this.fire('notebook-ready', { user: { id: client.getState().user.id, name } });
		});
	}

	#stop(): void {
		this.#hide();
		const client = this.#client;
		this.#client = null;
		this.#clientKey = '';
		void client?.destroy();
	}

	/** Nothing of the current client (another profile's notebooks) stays on screen or in reach. */
	#hide(): void {
		for (const off of this.#off.splice(0)) off();
		this.editor = null;
		this.#editorId = '';
		this.state = null;
		this.formats = null;
		this.link = null;
		this.menu = null;
		clearTimeout(this.#noticeTimer);
		this.notice = null;
		this.#lastNav = '';
	}

	#onState(client: NotebookClient): void {
		if (client !== this.#client) return;
		const state = client.getState();
		// Another page or notebook takes its text boxes away, so the ribbon lets go of the editor
		// before they go (the old one is still connected until the next render).
		if (state.pageId !== this.state?.pageId || state.notebookId !== this.state?.notebookId) {
			this.editor = null;
			this.#editorId = '';
			this.formats = null;
		}
		// A deleted text box takes its editor with it on the next render.
		if (this.#editorId && !state.containers.some((c) => c.id === this.#editorId)) {
			this.editor = null;
			this.#editorId = '';
			this.formats = null;
		}
		this.state = state;
		if (this.editor && !this.editor.dom.isConnected) this.editor = null;
		const nav = `${state.notebookId}|${state.sectionId}|${state.pageId}`;
		if (state.ready && nav !== this.#lastNav) {
			this.#lastNav = nav;
			this.fire('notebook-navigate', {
				notebookId: state.notebookId,
				sectionId: state.sectionId,
				pageId: state.pageId,
			} satisfies NotebookNavigateDetail);
		}
	}

	protected override willUpdate(changed: Map<string, unknown>): void {
		const restart = ['userId', 'userName', 'storageName', 'config', 'serverConfig'].some((k) =>
			changed.has(k),
		);
		if ((restart || !this.#client) && this.isConnected) this.#restart();
		// Also when a restart prop changed without a restart (an equal config, for example).
		if (changed.has('locale')) this.#client?.setNames(notebookNames(this.locale));
		if (changed.has('theme')) {
			if (this.theme === 'light' || this.theme === 'dark')
				this.setAttribute('data-office-theme', this.theme);
			else this.removeAttribute('data-office-theme');
		}
	}

	protected override firstUpdated(): void {
		this.#keytips = attachKeyTips(this.renderRoot as ShadowRoot);
	}

	protected override updated(): void {
		// The ribbon section never sets these; the patched buttons keep them across updates.
		for (const button of this.renderRoot.querySelectorAll<HTMLElement>(
			'office-ui-ribbon-section [command]',
		)) {
			const command = button.getAttribute('command') ?? '';
			const tip = COMMAND_KEYTIPS[command];
			if (tip && button.dataset.keytip !== tip) button.dataset.keytip = tip;
			if (ICON_ONLY.has(command) && !button.hasAttribute('icon-only'))
				button.setAttribute('icon-only', '');
		}
	}

	#picked(kind: 'picture' | 'file' | 'archive', input: HTMLInputElement): void {
		const files = [...(input.files ?? [])];
		input.value = '';
		if (!files.length) return;
		if (kind === 'archive') void importArchive(this, files[0]!);
		else void this.page()?.insertFiles(files);
	}

	#fileMenu(event: Event): void {
		const target = event.composedPath()[0] as HTMLElement | undefined;
		const rect = target?.getBoundingClientRect?.();
		notebookMenuAt(this, rect?.left ?? 0, rect?.bottom ?? 0);
	}

	#ribbon() {
		const s = this.state;
		const context = {
			t: this.tr,
			formats: this.editor ? this.formats : null,
			hasPage: !!s?.page,
			hasSection: !!s?.section,
			tool: this.tool,
			width: this.strokeWidth,
			navOpen: this.navOpen,
			todosOpen: this.todosOpen,
			zoom: this.zoom,
		};
		const colors = this.tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
		const current = this.tool === 'highlighter' ? this.highlighterColor : this.penColor;
		return html`<office-ui-ribbon
			class="ribbon"
			label=${this.t('ribbon.label')}
			file-label=${this.t('ribbon.file')}
			collapse-label=${this.t('ribbon.collapse')}
			file-keytip="F"
			collapsible
			@office-ribbon-file=${(e: Event) => this.#fileMenu(e)}
			@office-command=${(e: CustomEvent<{ command: string }>) => runCommand(this, e.detail.command)}
		>
			<div slot="quick-access" class="quick" role="toolbar" aria-label=${this.t('ribbon.quick')}>
				<office-ui-button
					icon="undo"
					icon-only
					command="undo"
					label=${this.t('cmd.undo')}
					data-keytip="1"
					?disabled=${!s?.canUndo}
				></office-ui-button>
				<office-ui-button
					icon="redo"
					icon-only
					command="redo"
					label=${this.t('cmd.redo')}
					data-keytip="2"
					?disabled=${!s?.canRedo}
				></office-ui-button>
			</div>
			${RIBBON_TABS.map(
				(tab: RibbonTab) =>
					html`<div
						id=${`${tab}-panel`}
						class="panel"
						data-ribbon-tab=${tab}
						data-label=${this.t(`tab.${tab}`)}
						data-tab-keytip=${TAB_KEYTIPS[tab]}
						data-keytip-level
					>
						<office-ui-ribbon-section
							.groups=${ribbonGroups(tab, context)}
						></office-ui-ribbon-section>
						${
							tab === 'draw'
								? html`<div class="pens" role="radiogroup" aria-label=${this.t('group.pens')}>
										${colors.map((c) => {
											const label = this.t('cmd.penColor', { color: this.t(`color.${c.name}`) });
											return html`<button
												class="swatch"
												role="radio"
												aria-checked=${String(c.value === current)}
												title=${label}
												aria-label=${label}
												style=${`--swatch:${c.value}`}
												@click=${() => setInkColor(this, c.value)}
											></button>`;
										})}
									</div>`
								: nothing
						}
					</div>`,
			)}
		</office-ui-ribbon>`;
	}

	#main(s: NotebookState | null) {
		if (!s?.ready || s.loading)
			return html`<p class="loading" role="status">${this.t('app.loading')}</p>`;
		if (!s.notebook)
			return html`<div class="empty">
				<p>${this.t('app.empty')}</p>
				<p>${this.t('app.emptyHint')}</p>
				<office-ui-button
					command="create-notebook"
					variant="primary"
					icon="plus"
					label=${this.t('app.createNotebook')}
					@office-command=${() => void this.#client?.createNotebook().catch(() => undefined)}
				></office-ui-button>
			</div>`;
		return html`<notebook-page
			.client=${this.#client}
			.state=${s}
			.tool=${this.tool}
			.inkColor=${this.tool === 'highlighter' ? this.highlighterColor : this.penColor}
			.inkWidth=${this.tool === 'highlighter' ? this.strokeWidth * 4 : this.strokeWidth}
			.zoom=${this.zoom}
			.focusId=${this.focusId}
			.locale=${this.locale}
			@nb-add-page=${() => runCommand(this, 'new-page')}
			@nb-container-menu=${(e: CustomEvent<{ id: string; x: number; y: number }>) => {
				const context = menuContext(this);
				if (context)
					this.openMenu(
						containerMenu(
							context,
							e.detail.id,
							(id) => openEmbedded(this, id),
							(id) => openEmbedded(this, id, true),
						),
						e.detail.x,
						e.detail.y,
					);
			}}
			@nb-file-open=${(e: CustomEvent<{ id: string }>) => openEmbedded(this, e.detail.id)}
			@nb-file-download=${(e: CustomEvent<{ id: string }>) => openEmbedded(this, e.detail.id, true)}
		></notebook-page>`;
	}

	#nav(s: NotebookState) {
		return html`<notebook-nav
			class="nav"
			.state=${s}
			.locale=${this.locale}
			@nb-select-section=${(e: CustomEvent<{ id: string }>) => this.#client?.selectSection(e.detail.id)}
			@nb-select-page=${(e: CustomEvent<{ id: string }>) => this.#client?.selectPage(e.detail.id)}
			@nb-rename=${(e: CustomEvent<{ kind: NavItemKind; id: string; name: string }>) => renameItem(this, e.detail)}
			@nb-item-menu=${(e: CustomEvent<{ kind: NavItemKind; id: string; x: number; y: number }>) => itemMenu(this, e.detail)}
			@nb-add-section=${() => runCommand(this, 'new-section')}
			@nb-add-page=${() => runCommand(this, 'new-page')}
			@nb-delete-item=${(e: CustomEvent<{ kind: NavItemKind; id: string }>) => deleteItem(this, e.detail)}
			@nb-move-item=${(e: CustomEvent<{ kind: NavItemKind; id: string; direction: -1 | 1 }>) => moveItem(this, e.detail)}
			@nb-drop-item=${(e: CustomEvent<Parameters<typeof dropItem>[1]>) => dropItem(this, e.detail)}
			@nb-search=${(e: CustomEvent<{ query: string }>) => this.#client?.search(e.detail.query)}
			@nb-open-hit=${(e: CustomEvent<{ sectionId: string; pageId: string }>) => go(this, e.detail.sectionId, e.detail.pageId)}
			@nb-notebook-menu=${(e: CustomEvent<{ x: number; y: number }>) => notebookMenuAt(this, e.detail.x, e.detail.y)}
		></notebook-nav>`;
	}

	protected override render() {
		const s = this.state;
		// Memory-only notebooks are said first, in either mode: the list of them lives on the device.
		const status = !s?.notebook
			? 'closed'
			: !s.persistent
				? 'memory'
				: s.unsaved
					? 'unsaved'
					: s.mode !== 'local'
						? s.status
						: 'local';
		const peers = s?.peers ?? [];
		return html`<div
			class="app"
			@keydown=${(e: KeyboardEvent) => appKeys(this, e)}
			@nb-text-focus=${(e: CustomEvent<{ id: string; view: EditorView }>) => {
				this.editor = e.detail.view;
				this.#editorId = e.detail.id;
				this.formats = activeFormats(e.detail.view.state);
				this.#client?.focusContainer(e.detail.id);
			}}
			@nb-text-blur=${() => this.#client?.focusContainer(null)}
			@nb-format=${(e: CustomEvent<{ id: string; formats: ActiveFormats }>) => {
				// Every text box reports as it changes (a collaborator's edit, a ticked box); the ribbon
				// shows the one being edited.
				if (e.detail.id === this.#editorId) this.formats = e.detail.formats;
			}}
			@nb-undo=${() => this.#client?.undo()}
			@nb-redo=${() => this.#client?.redo()}
			@nb-link-request=${() => runCommand(this, 'link')}
			@nb-notice=${(e: CustomEvent<{ code: 'file-too-large' }>) => this.notify(this.t(`notice.${e.detail.code}`))}
		>
			${this.#ribbon()}
			<div class="body">
				${this.navOpen && s?.notebook ? this.#nav(s) : nothing}
				<main class="main" aria-busy=${String(!s?.ready || s.loading)}>${this.#main(s)}</main>
				${
					this.todosOpen && s?.notebook
						? html`<notebook-todos
								class="todos"
								.state=${s}
								.locale=${this.locale}
								@nb-todo=${(e: CustomEvent<{ item: NotebookState['todos'][number]; done: boolean }>) => this.#client?.setTodo(e.detail.item, e.detail.done)}
								@nb-open-todo=${(e: CustomEvent<{ pageId: string; sectionId: string }>) => go(this, e.detail.sectionId, e.detail.pageId)}
								@nb-close-pane=${() => (this.todosOpen = false)}
							></notebook-todos>`
						: nothing
				}
			</div>
			<footer class="status">
				<span class="sync" data-status=${status}>${this.t(`status.${status}`)}</span>
				${peers.length ? html`<span class="people">${this.tn('status.people', peers.length)}</span>` : nothing}
				<office-ui-presence
					class="presence"
					.participants=${peers.map((p) => ({ id: String(p.clientId), name: p.name || this.t('peer.someone'), color: p.color }))}
					max="5"
				></office-ui-presence>
				<span class="zoom">${this.t('status.zoom', { value: Math.round(this.zoom * 100) })}</span>
			</footer>
			${this.#notice()}
			${
				this.menu
					? html`<office-ui-context-menu
							.state=${this.menu}
							@office-menu-request=${(e: CustomEvent<{ id: string }>) => {
								const spec = this.menu?.spec;
								this.menu = null;
								spec?.run(e.detail.id);
							}}
							@office-menu-close=${() => (this.menu = null)}
						></office-ui-context-menu>`
					: nothing
			}
			<notebook-link-dialog
				.value=${this.link}
				.locale=${this.locale}
				@nb-link-apply=${(e: CustomEvent<{ href: string; text: string }>) => applyLink(this, e.detail.href, e.detail.text)}
				@nb-link-remove=${() => applyLink(this, null)}
				@nb-link-cancel=${() => (this.link = null)}
			></notebook-link-dialog>
			<input
				type="file"
				data-pick="picture"
				accept="image/*"
				multiple
				hidden
				@change=${(e: Event) => this.#picked('picture', e.target as HTMLInputElement)}
			/>
			<input
				type="file"
				data-pick="file"
				multiple
				hidden
				@change=${(e: Event) => this.#picked('file', e.target as HTMLInputElement)}
			/>
			<input
				type="file"
				data-pick="archive"
				accept=".zip,application/zip"
				hidden
				@change=${(e: Event) => this.#picked('archive', e.target as HTMLInputElement)}
			/>
		</div>`;
	}

	#notice() {
		const notice = this.notice;
		if (!notice) return nothing;
		return html`<div class="notice" role="status">
			<span>${notice.message}</span>
			${
				notice.undo
					? html`<button
							class="undo"
							@click=${() => {
								notice.undo?.();
								this.notice = null;
							}}
						>
							${this.t('notice.undo')}
						</button>`
					: nothing
			}
			<office-ui-button
				command="notice-dismiss"
				size="small"
				icon="close"
				icon-only
				label=${this.t('notice.dismiss')}
				@office-command=${() => (this.notice = null)}
			></office-ui-button>
		</div>`;
	}
}

// Everything the app renders is defined before the app is: a property set on an element before
// its class is registered (a ribbon section's groups) would shadow the class's accessor for good.
export const defineNotebookApp = definer(
	'notebook-app',
	() => {
		registerControls();
		registerNotebookIcons();
		return NotebookApp;
	},
	[
		definePresence,
		defineNotebookNav,
		defineNotebookPage,
		defineNotebookTodos,
		defineNotebookLinkDialog,
	],
);
