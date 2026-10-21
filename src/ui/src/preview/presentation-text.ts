// The wording of the presentation reading surface in every shipped locale (moved from the Teams
// dictionaries with the element; the reading-view note no longer names another program).
import type { MessageDictionary, OfficeLocale } from 'ooxml-core/i18n';
import { createProductI18n } from '../i18n/product-i18n';

const en = {
	'pptx.badSize': 'The presentation has an invalid slide size',
	'pptx.canvas': 'Slide navigation canvas',
	'pptx.hidden': '(hidden)',
	'pptx.navigation': 'Slide navigation',
	'pptx.next': 'Next slide',
	'pptx.noSlides': 'The presentation has no slides',
	'pptx.notes': 'Speaker notes',
	'pptx.previous': 'Previous slide',
	'pptx.readingView':
		'Reading view. Animation, transitions and editing are unavailable. Layout and fonts may differ from the original.',
	'pptx.slide': 'Slide {n}',
	'pptx.slideOf': 'Slide {n} of {total}',
	'pptx.slideText': 'Slide text',
	'pptx.warnings': 'Compatibility warnings',
} as const;

export type PresentationKey = keyof typeof en;
type Dictionary = Record<PresentationKey, string>;

const de: Dictionary = {
	'pptx.badSize': 'Die Präsentation hat eine ungültige Foliengröße',
	'pptx.canvas': 'Folienansicht zur Navigation',
	'pptx.hidden': '(ausgeblendet)',
	'pptx.navigation': 'Foliennavigation',
	'pptx.next': 'Nächste Folie',
	'pptx.noSlides': 'Die Präsentation enthält keine Folien',
	'pptx.notes': 'Sprechernotizen',
	'pptx.previous': 'Vorherige Folie',
	'pptx.readingView':
		'Leseansicht. Animationen, Übergänge und Bearbeitung sind nicht verfügbar. Layout und Schriftarten können vom Original abweichen.',
	'pptx.slide': 'Folie {n}',
	'pptx.slideOf': 'Folie {n} von {total}',
	'pptx.slideText': 'Folientext',
	'pptx.warnings': 'Kompatibilitätswarnungen',
};

const es: Dictionary = {
	'pptx.badSize': 'La presentación tiene un tamaño de diapositiva no válido',
	'pptx.canvas': 'Lienzo de navegación de diapositivas',
	'pptx.hidden': '(oculta)',
	'pptx.navigation': 'Navegación de diapositivas',
	'pptx.next': 'Diapositiva siguiente',
	'pptx.noSlides': 'La presentación no tiene diapositivas',
	'pptx.notes': 'Notas del orador',
	'pptx.previous': 'Diapositiva anterior',
	'pptx.readingView':
		'Vista de lectura. Las animaciones, las transiciones y la edición no están disponibles. El diseño y las fuentes pueden diferir del original.',
	'pptx.slide': 'Diapositiva {n}',
	'pptx.slideOf': 'Diapositiva {n} de {total}',
	'pptx.slideText': 'Texto de la diapositiva',
	'pptx.warnings': 'Advertencias de compatibilidad',
};

const fr: Dictionary = {
	'pptx.badSize': 'La présentation a une taille de diapositive non valide',
	'pptx.canvas': 'Zone de navigation des diapositives',
	'pptx.hidden': '(masquée)',
	'pptx.navigation': 'Navigation dans les diapositives',
	'pptx.next': 'Diapositive suivante',
	'pptx.noSlides': 'La présentation ne contient aucune diapositive',
	'pptx.notes': "Notes de l'orateur",
	'pptx.previous': 'Diapositive précédente',
	'pptx.readingView':
		"Mode lecture. Les animations, les transitions et la modification ne sont pas disponibles. La mise en page et les polices peuvent différer de l'original.",
	'pptx.slide': 'Diapositive {n}',
	'pptx.slideOf': 'Diapositive {n} sur {total}',
	'pptx.slideText': 'Texte de la diapositive',
	'pptx.warnings': 'Avertissements de compatibilité',
};

const zhCN: Dictionary = {
	'pptx.badSize': '演示文稿的幻灯片大小无效',
	'pptx.canvas': '幻灯片导航画布',
	'pptx.hidden': '（已隐藏）',
	'pptx.navigation': '幻灯片导航',
	'pptx.next': '下一张幻灯片',
	'pptx.noSlides': '演示文稿没有幻灯片',
	'pptx.notes': '演讲者备注',
	'pptx.previous': '上一张幻灯片',
	'pptx.readingView': '阅读视图。动画、切换和编辑不可用。版式和字体可能与原文件不同。',
	'pptx.slide': '幻灯片 {n}',
	'pptx.slideOf': '第 {n} 张，共 {total} 张',
	'pptx.slideText': '幻灯片文本',
	'pptx.warnings': '兼容性警告',
};

export const PRESENTATION_MESSAGES: Readonly<Record<OfficeLocale, MessageDictionary>> = {
	en,
	de,
	es,
	fr,
	'zh-CN': zhCN,
};

export const presentationI18n = createProductI18n<PresentationKey>(PRESENTATION_MESSAGES);
