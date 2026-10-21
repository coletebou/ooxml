// The document a message's sanitised HTML (sanitize.ts) is shown in by <mail-html-frame>: its
// Content-Security-Policy, the frame's own type and paper colours, the message's style sheets and
// its body, on a `<body>` with the attributes that style the message's own. New code.

/**
 * The attributes of a message's `<body>` that style it, which the frame's body takes: its style,
 * class and id, its colours (`bgcolor`, `text`, and `link`, `vlink` and `alink` for its links) and
 * its picture (`background`). Not its margins (`leftmargin`, `marginwidth`, ...): the frame keeps
 * its own spacing round a message, which a style of the body still changes.
 */
export const BODY_ATTRIBUTES = [
	'style',
	'class',
	'id',
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

/** Colours and type of the frame, read from the host's tokens (the frame cannot see them). */
export interface FrameStyle {
	font: string;
	fontSize: string;
	color: string;
	background: string;
	link: string;
	quote: string;
}

/** What a frame shows of a message: its style sheets, its body, and the attributes of its body. */
export interface FrameContent {
	sheets: readonly string[];
	body: string;
	bodyAttributes?: BodyAttributes;
}

/** `value` as the text of an attribute in double quotes. */
const attributeText = (value: string): string =>
	value.replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * The frame's whole document: a CSP that allows inline styles and, only when `allowRemote`, remote
 * images and fonts; links open in a new tab. Message HTML is written for a light page, so it is
 * shown on paper colours in every theme. Each of the message's style sheets is written in a
 * `<style>` of its own, as the message had them, so a browser reads each on its own. A sheet cannot
 * end its element early: an end tag starts `</s`, and each one there becomes `<\/s`, the same `/`
 * to CSS. Nothing else is touched, so a comment opened right after a `<` stays a comment.
 * The frame's body has the attributes that style the message's own body (`BODY_ATTRIBUTES`), so
 * the message's background fills the frame. A colour one of them gives (`bgcolor`, `text`, those
 * of the links) is a presentational hint, which every style rule wins over, so the frame's own rule
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
	const base = `html{color-scheme:light}body{margin:0;padding:.75em;font-family:${style.font};font-size:${style.fontSize};overflow-wrap:anywhere}body:where(:not([text])){color:${style.color}}body:where(:not([bgcolor])){background-color:${style.background}}:where(body:not([link]):not([vlink]):not([alink])) a{color:${style.link}}img{max-width:100%;height:auto}blockquote{margin:0 0 0 .5em;padding-left:.75em;border-left:.2em solid ${style.quote}}pre{white-space:pre-wrap}`;
	const sheets = content.sheets.map(
		(sheet) => `<style>${sheet.replace(/<\/(?=s)/gi, '<\\/')}</style>`,
	);
	const attributes = BODY_ATTRIBUTES.map((name) => {
		const value = content.bodyAttributes?.[name];
		return value === undefined ? '' : ` ${name}="${attributeText(value)}"`;
	});
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>${base}</style>${sheets.join('')}</head><body${attributes.join('')}>${content.body}</body></html>`;
}
