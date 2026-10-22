// The document a message's sanitised HTML (sanitize.ts) is shown in by <mail-html-frame>: its
// Content-Security-Policy, the frame's own type and paper colours, the message's style sheets and
// its body, in an `<html>` and on a `<body>` with the attributes of the message's own. New code.

/**
 * The attributes of a message's `<body>` that style it, which the frame's body takes: its style,
 * class and id, its direction and language (`dir`, `lang`), its colours (`bgcolor`, `text`, and
 * `link`, `vlink` and `alink` for its links) and its picture (`background`). Not its margins
 * (`leftmargin`, `marginwidth`, ...): the frame keeps its own spacing round a message, which a style
 * of the body still changes.
 */
export const BODY_ATTRIBUTES = [
	'style',
	'class',
	'id',
	'dir',
	'lang',
	'bgcolor',
	'text',
	'link',
	'vlink',
	'alink',
	'background',
] as const;
export type BodyAttribute = (typeof BODY_ATTRIBUTES)[number];
/** The attributes that style a message's body, by name. */
export type BodyAttributes = Readonly<Partial<Record<BodyAttribute, string>>>;

/**
 * The attributes of a message's `<html>` element, which the frame's own takes: the direction and
 * language of the whole message (`dir`, `lang`), which its body has unless it gives its own, and the
 * style, class and id the message's style sheets may style it by.
 */
export const HTML_ATTRIBUTES = ['style', 'class', 'id', 'dir', 'lang'] as const;
export type HtmlAttribute = (typeof HTML_ATTRIBUTES)[number];
/** The attributes of a message's html element, by name. */
export type HtmlAttributes = Readonly<Partial<Record<HtmlAttribute, string>>>;

/** Colours and type of the frame, read from the host's tokens (the frame cannot see them). */
export interface FrameStyle {
	font: string;
	fontSize: string;
	color: string;
	background: string;
	link: string;
	quote: string;
}

/**
 * What a frame shows of a message: its style sheets, its body, and the attributes of its html
 * element and of its body.
 */
export interface FrameContent {
	sheets: readonly string[];
	/** The media each sheet applies to, `''` (or none given) for every medium. */
	sheetMedia?: readonly string[];
	body: string;
	htmlAttributes?: HtmlAttributes;
	bodyAttributes?: BodyAttributes;
}

/** `value` as the text of an attribute: its own, whatever it holds. */
const attributeValue = (value: string): string =>
	`"${value.replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`)}"`;

/** The attributes named in `names` that `values` gives, as the text of a start tag. */
const attributeText = (
	names: readonly string[],
	values: Readonly<Record<string, string | undefined>> | undefined,
): string =>
	names
		.map((name) => {
			const value = values?.[name];
			return value === undefined ? '' : ` ${name}=${attributeValue(value)}`;
		})
		.join('');

/**
 * The frame's whole document: a CSP that allows inline styles and, only when `allowRemote`, remote
 * images and fonts; links open in a new tab. Message HTML is written for a light page, so it is
 * shown on paper colours in every theme. Each of the message's style sheets is written in a
 * `<style>` of its own, as the message had them, so a browser reads each on its own, for the media
 * its element named. A sheet cannot end its element early: an end tag starts `</s`, and each one
 * there becomes `<\/s`, the same `/` to CSS. Nothing else is touched, so a comment opened right
 * after a `<` stays a comment.
 * The frame's html element and body have the attributes of the message's own (`HTML_ATTRIBUTES`,
 * `BODY_ATTRIBUTES`), so the message is shown in its own direction and language, and its
 * background fills the frame. The frame's own rules name no side of the page, only where a line
 * starts, so they follow the message's direction: a quote's bar is on its right in a message
 * written right to left. A colour one of the body's attributes gives (`bgcolor`, `text`, those of
 * the links) is a presentational hint, which every style rule wins over, so the frame's own rule
 * for that colour applies only to a body without the attribute; it keeps the specificity it had, so
 * the message's own `body` and `a` rules still win over both, as they do over the attribute in a
 * browser. The body's style, its own, wins over all of them.
 */
export function emailDocument(
	content: FrameContent,
	allowRemote: boolean,
	style: FrameStyle,
): string {
	const remote = allowRemote ? ' https: http:' : '';
	const csp = [
		"default-src 'none'",
		`img-src data: blob:${remote}`,
		"style-src 'unsafe-inline'",
		`font-src data:${remote}`,
		"media-src 'none'",
		"frame-src 'none'",
		"form-action 'none'",
		"base-uri 'none'",
	].join('; ');
	const base = `html{color-scheme:light}body{margin:0;padding:.75em;font-family:${style.font};font-size:${style.fontSize};overflow-wrap:anywhere}body:where(:not([text])){color:${style.color}}body:where(:not([bgcolor])){background-color:${style.background}}:where(body:not([link]):not([vlink]):not([alink])) a{color:${style.link}}img{max-width:100%;height:auto}blockquote{margin:0;margin-inline-start:.5em;padding-inline-start:.75em;border-inline-start:.2em solid ${style.quote}}pre{white-space:pre-wrap}`;
	const sheets = content.sheets.map((sheet, i) => {
		const media = content.sheetMedia?.[i];
		const named = media ? ` media=${attributeValue(media)}` : '';
		return `<style${named}>${sheet.replace(/<\/(?=s)/gi, '<\\/')}</style>`;
	});
	const root = attributeText(HTML_ATTRIBUTES, content.htmlAttributes);
	const body = attributeText(BODY_ATTRIBUTES, content.bodyAttributes);
	return `<!doctype html><html${root}><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${base}</style>${sheets.join('')}</head><body${body}>${content.body}</body></html>`;
}
