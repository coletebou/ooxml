import type { PptxCommentDrafts, SlideSizeEmu, SlideSizeRescaleMode } from 'ooxml-ui/pptx';
import type {
	PptxAppProperties,
	PptxComment,
	PptxCoreProperties,
	PptxCustomProperty,
	PptxElement,
	PptxHandoutMaster,
	PptxModernCommentAuthor,
	PptxNotesMaster,
	PptxPresentationProperties,
	PptxSlide,
	PptxSlideMaster,
	PptxTagCollection,
	PptxTheme,
	PptxThemeOption,
	ShapeStyle,
	TextStyle,
	ParsedTableStyleMap,
} from 'pptx-viewer-core';

import type { CanvasSize, TableCellEditorState, ViewerMode } from '../../types';

// ---------------------------------------------------------------------------
// Inspector tab discriminant
// ---------------------------------------------------------------------------

export type InspectorTab = 'elements' | 'properties' | 'comments';

// ---------------------------------------------------------------------------
// Inspector pane props
// ---------------------------------------------------------------------------

export interface InspectorPaneProps {
	isOpen: boolean;
	canEdit: boolean;
	mode: ViewerMode;
	activeSlide: PptxSlide | undefined;
	slides: PptxSlide[];
	/** `data.customShows`, for the Action Settings `customShow` target picker. */
	customShows: Array<{ id: string; name: string }>;
	canvasSize: CanvasSize;
	selectedElement: PptxElement | null;
	selectedElementIds: string[];
	tableEditorState?: TableCellEditorState | null;
	activeTab: InspectorTab;
	onSetActiveTab: (tab: InspectorTab) => void;
	onClose: () => void;
	onUpdateElementStyle: (updates: Partial<ShapeStyle>) => void;
	onUpdateTextStyle: (updates: Partial<TextStyle>) => void;
	onUpdateElement: (updates: Partial<PptxElement>) => void;
	onUpdateSlide: (updates: Partial<PptxSlide>) => void;
	onSelectElement: (elementId: string | null) => void;
	onMoveLayer: (direction: string) => void;
	onMoveLayerToEdge: (direction: string) => void;
	onDeleteElement: () => void;
	presentationProperties: PptxPresentationProperties;
	onUpdatePresentationProperties: (updates: Partial<PptxPresentationProperties>) => void;
	notesMaster?: PptxNotesMaster;
	handoutMaster?: PptxHandoutMaster;
	notesCanvasSize?: CanvasSize;
	coreProperties?: PptxCoreProperties;
	appProperties?: PptxAppProperties;
	customProperties: PptxCustomProperty[];
	themeOptions: PptxThemeOption[];
	onUpdateCoreProperties: (updates: Partial<PptxCoreProperties>) => void;
	onUpdateAppProperties: (updates: Partial<PptxAppProperties>) => void;
	onUpdateCustomProperties: (next: PptxCustomProperty[]) => void;
	tagCollections?: PptxTagCollection[];
	onUpdateTagCollections?: (next: PptxTagCollection[]) => void;
	onApplyTheme: (themePath: string, applyToAllMasters: boolean) => void;
	/** The active slide's comments, shown in the shared comments pane. */
	comments: PptxComment[];
	/** Who writes new comments, and whose comments offer Edit. */
	commentAuthorName: string;
	/** Modern comment authors: the people an `@` offers. */
	commentAuthors?: PptxModernCommentAuthor[];
	/** The active slide's whole new comment list, to commit as one history entry. */
	onCommentsChange: (next: PptxComment[]) => void;
	/** The viewer's store of unposted comments, so a draft outlives the Comments tab. */
	commentDrafts?: PptxCommentDrafts;
	onUpdateCanvasSize: (size: CanvasSize) => void;
	/** The deck's `p:sldSz` in EMU, forwarded to the Slide Size card. */
	slideSizeEmu?: SlideSizeEmu | undefined;
	/**
	 * Applies a Slide Size preset / orientation pick. `rescaleMode` is set only
	 * when the user confirmed a Maximize/Ensure Fit prompt for a size change
	 * that affects existing content (see `SlideSizeCard`'s rescale prompt);
	 * omitted, the size changes without touching any element.
	 */
	onUpdateSlideSize?: (size: SlideSizeEmu, rescaleMode?: SlideSizeRescaleMode) => void;
	editTemplateMode?: boolean;
	slideMasters?: PptxSlideMaster[];
	onSetTemplateBackground?: (path: string, backgroundColor: string) => void;
	onGetTemplateBackgroundColor?: (path: string) => string | undefined;
	mediaDataUrls?: Map<string, string>;
	theme?: PptxTheme;
	/**
	 * The deck's parsed `ppt/tableStyles.xml` map, needed by the table
	 * properties panel's "Edit style...". See `TablePropertiesPanel`'s
	 * docblock for why this is optional.
	 */
	tableStyleMap?: ParsedTableStyleMap;
	onTableStyleMapChange?: (nextMap: ParsedTableStyleMap) => void;
	onDeleteTableStyle?: (styleId: string) => void;
	/** Width of the panel in pixels (for resizable panels). */
	panelWidth?: number;
}
