// The notebook's ribbon as data for `office-ui-ribbon-section`: Home (text formatting, styles, the
// To Do tag), Insert (text box, picture, file, link, pages and sections), Draw (type, pen,
// highlighter, eraser and stroke widths) and View (panes and zoom). Pressed and disabled states
// come from the notebook state and the formatting of the last active text container.
import type { OfficeRibbonGroupView } from '../ribbon/ribbon-section';
import type { ActiveFormats } from 'ooxml-core/notebook/editor';
import type { NotebookKey } from './i18n/translator';
import type { NotebookTool } from './page-canvas';

export type RibbonTab = 'home' | 'insert' | 'draw' | 'view';
export const RIBBON_TABS: readonly RibbonTab[] = ['home', 'insert', 'draw', 'view'];
export const TAB_KEYTIPS: Record<RibbonTab, string> = {
	home: 'H',
	insert: 'N',
	draw: 'D',
	view: 'W',
};

/** KeyTips of the commands (Alt, then the tab's letter, then these). */
export const COMMAND_KEYTIPS: Record<string, string> = {
	bold: '1',
	italic: '2',
	underline: '3',
	strike: '4',
	highlight: 'I',
	bullets: 'U',
	numbering: 'N',
	outdent: 'AO',
	indent: 'AI',
	normal: 'S0',
	heading1: 'S1',
	heading2: 'S2',
	heading3: 'S3',
	todo: 'T',
	text: 'X',
	picture: 'P',
	file: 'F',
	link: 'K',
	'new-page': 'G',
	'new-subpage': 'B',
	'new-section': 'E',
	'new-group': 'R',
	'tool-type': 'Y',
	'tool-pen': 'P',
	'tool-highlighter': 'H',
	'tool-eraser': 'E',
	'width-thin': '1',
	'width-medium': '2',
	'width-thick': '3',
	nav: 'V',
	todos: 'T',
	search: 'S',
	'zoom-out': 'ZO',
	'zoom-reset': 'ZR',
	'zoom-in': 'ZI',
};

/** Commands drawn as icons only (their label is the ScreenTip). */
export const ICON_ONLY = new Set([
	'bold',
	'italic',
	'underline',
	'strike',
	'highlight',
	'bullets',
	'numbering',
	'outdent',
	'indent',
]);

export interface RibbonContext {
	t: (key: NotebookKey) => string;
	formats: ActiveFormats | null;
	hasPage: boolean;
	hasSection: boolean;
	tool: NotebookTool;
	width: number;
	navOpen: boolean;
	todosOpen: boolean;
	zoom: number;
}

const WIDTHS = { 'width-thin': 1, 'width-medium': 2.5, 'width-thick': 5 } as const;
export const strokeWidthOf = (command: string): number | undefined =>
	WIDTHS[command as keyof typeof WIDTHS];

export function ribbonGroups(tab: RibbonTab, c: RibbonContext): OfficeRibbonGroupView[] {
	const f = c.formats;
	const text = !!f && c.hasPage;
	const cmd = (
		id: string,
		label: NotebookKey,
		icon: string,
		extra: Partial<OfficeRibbonGroupView['commands'][number]> = {},
	) => ({
		id,
		label: c.t(label),
		icon,
		...extra,
	});
	if (tab === 'home')
		return [
			{
				id: 'text',
				label: c.t('group.text'),
				commands: [
					cmd('bold', 'cmd.bold', 'bold', {
						size: 'small',
						column: 0,
						pressed: !!f?.bold,
						disabled: !text,
					}),
					cmd('italic', 'cmd.italic', 'italic', {
						size: 'small',
						column: 0,
						pressed: !!f?.italic,
						disabled: !text,
					}),
					cmd('underline', 'cmd.underline', 'underline', {
						size: 'small',
						column: 0,
						pressed: !!f?.underline,
						disabled: !text,
					}),
					cmd('strike', 'cmd.strike', 'strikethrough', {
						size: 'small',
						column: 1,
						pressed: !!f?.strike,
						disabled: !text,
					}),
					cmd('highlight', 'cmd.highlight', 'notebook-highlight', {
						size: 'small',
						column: 1,
						pressed: !!f?.highlight,
						disabled: !text,
					}),
					cmd('bullets', 'cmd.bullets', 'bullets', {
						size: 'small',
						column: 2,
						pressed: f?.list === 'bullet',
						disabled: !text,
					}),
					cmd('numbering', 'cmd.numbering', 'notebook-numbering', {
						size: 'small',
						column: 2,
						pressed: f?.list === 'ordered',
						disabled: !text,
					}),
					cmd('outdent', 'cmd.outdent', 'indentDecrease', {
						size: 'small',
						column: 3,
						disabled: !text || !f?.list,
					}),
					cmd('indent', 'cmd.indent', 'indentIncrease', {
						size: 'small',
						column: 3,
						disabled: !text || !f?.list,
					}),
				],
			},
			{
				id: 'styles',
				label: c.t('group.styles'),
				commands: [
					cmd('normal', 'cmd.normal', 'notebook-type', {
						size: 'small',
						column: 0,
						pressed: f?.block === 'paragraph',
						disabled: !text,
					}),
					cmd('heading1', 'cmd.heading1', 'notebook-type', {
						size: 'small',
						column: 0,
						pressed: f?.block === 'heading1',
						disabled: !text,
					}),
					cmd('heading2', 'cmd.heading2', 'notebook-type', {
						size: 'small',
						column: 1,
						pressed: f?.block === 'heading2',
						disabled: !text,
					}),
					cmd('heading3', 'cmd.heading3', 'notebook-type', {
						size: 'small',
						column: 1,
						pressed: f?.block === 'heading3',
						disabled: !text,
					}),
				],
			},
			{
				id: 'tags',
				label: c.t('group.tags'),
				commands: [
					cmd('todo', 'cmd.todo', 'notebook-todo', {
						size: 'large',
						pressed: !!f?.todo,
						disabled: !text,
					}),
				],
			},
		];
	if (tab === 'insert')
		return [
			{
				id: 'insert',
				label: c.t('group.insert'),
				commands: [
					cmd('text', 'cmd.text', 'notebook-textBox', { size: 'large', disabled: !c.hasPage }),
					cmd('picture', 'cmd.picture', 'notebook-picture', {
						size: 'large',
						disabled: !c.hasPage,
					}),
					cmd('file', 'cmd.file', 'notebook-file', { size: 'large', disabled: !c.hasPage }),
					cmd('link', 'cmd.link', 'notebook-link', { size: 'large', disabled: !text }),
				],
			},
			{
				id: 'pages',
				label: c.t('group.pages'),
				commands: [
					cmd('new-page', 'cmd.newPage', 'notebook-page', {
						size: 'small',
						column: 0,
						disabled: !c.hasSection,
					}),
					cmd('new-subpage', 'cmd.newSubpage', 'notebook-subpage', {
						size: 'small',
						column: 0,
						disabled: !c.hasPage,
					}),
					cmd('new-section', 'cmd.newSection', 'notebook-section', { size: 'small', column: 1 }),
					cmd('new-group', 'cmd.newGroup', 'notebook-group', { size: 'small', column: 1 }),
				],
			},
		];
	if (tab === 'draw')
		return [
			{
				id: 'tools',
				label: c.t('group.tools'),
				commands: [
					cmd('tool-type', 'cmd.type', 'notebook-type', {
						size: 'large',
						pressed: c.tool === 'type',
					}),
					cmd('tool-pen', 'cmd.pen', 'pencil', {
						size: 'large',
						pressed: c.tool === 'pen',
						disabled: !c.hasPage,
					}),
					cmd('tool-highlighter', 'cmd.highlighter', 'notebook-highlighter', {
						size: 'large',
						pressed: c.tool === 'highlighter',
						disabled: !c.hasPage,
					}),
					cmd('tool-eraser', 'cmd.eraser', 'notebook-eraser', {
						size: 'large',
						pressed: c.tool === 'eraser',
						disabled: !c.hasPage,
					}),
				],
			},
			{
				id: 'widths',
				label: c.t('group.pens'),
				commands: (['width-thin', 'width-medium', 'width-thick'] as const).map((id, column) =>
					cmd(
						id,
						id === 'width-thin' ? 'cmd.thin' : id === 'width-medium' ? 'cmd.medium' : 'cmd.thick',
						'line',
						{
							size: 'small',
							column,
							pressed: c.width === WIDTHS[id],
						},
					),
				),
			},
		];
	return [
		{
			id: 'show',
			label: c.t('group.show'),
			commands: [
				cmd('nav', 'cmd.nav', 'notebook-pane', { size: 'large', pressed: c.navOpen }),
				cmd('todos', 'cmd.todos', 'notebook-todo', { size: 'large', pressed: c.todosOpen }),
				cmd('search', 'cmd.search', 'search', { size: 'large' }),
			],
		},
		{
			id: 'zoom',
			label: c.t('group.zoom'),
			commands: [
				cmd('zoom-out', 'cmd.zoomOut', 'zoomOut', { size: 'large', disabled: c.zoom <= 0.5 }),
				cmd('zoom-reset', 'cmd.zoomReset', 'fitPage', { size: 'large', disabled: c.zoom === 1 }),
				cmd('zoom-in', 'cmd.zoomIn', 'zoomIn', { size: 'large', disabled: c.zoom >= 2 }),
			],
		},
	];
}
