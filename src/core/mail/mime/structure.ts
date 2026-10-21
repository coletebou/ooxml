// Which parts of a message are its text body, its HTML body and its attachments: the algorithm of
// RFC 8621 section 4.1.4, and the text and HTML a reader shows from them. New code.
import { parseContentId } from './addresses';
import { decodeCharset } from './charset';
import type { MimePart } from './types';

export interface BodyStructure {
	textBody: MimePart[];
	htmlBody: MimePart[];
	attachments: MimePart[];
}

export interface MessageBodies {
	text: string | null;
	html: string | null;
	attachments: MimePart[];
}

/** RFC 8621 `isInlineMediaType`: images, audio and video a reader can show within the body. */
export function isInlineMediaType(type: string): boolean {
	return type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/');
}

/**
 * The root of a multipart/related: the part its `start` parameter names by Content-ID, else the
 * first (RFC 2387 3.2). RFC 8621's algorithm always takes the first.
 */
function relatedRoot(related: MimePart): number {
	const start = parseContentId(related.params.start);
	const index = start === null ? -1 : related.parts.findIndex((part) => part.cid === start);
	return Math.max(0, index);
}

/**
 * RFC 8621 section 4.1.4 `parseStructure`, statement for statement but for one fix below and
 * `root`: the part of a multipart/related its `start` names (RFC 2387), where the RFC has 0.
 */
function parseStructure(
	parts: readonly MimePart[],
	multipartType: string,
	inAlternative: boolean,
	htmlBody: MimePart[] | null,
	textBody: MimePart[] | null,
	attachments: MimePart[],
	root = 0,
): void {
	const textLength = textBody ? textBody.length : -1;
	const htmlLength = htmlBody ? htmlBody.length : -1;
	for (const [i, part] of parts.entries()) {
		const isMultipart = part.type.startsWith('multipart/');
		const isInline =
			part.disposition !== 'attachment' &&
			(part.type === 'text/plain' || part.type === 'text/html' || isInlineMediaType(part.type)) &&
			(i === root || (multipartType !== 'related' && (isInlineMediaType(part.type) || !part.name)));
		if (isMultipart) {
			const subMultiType = part.type.slice('multipart/'.length);
			parseStructure(
				part.parts,
				subMultiType,
				inAlternative || subMultiType === 'alternative',
				htmlBody,
				textBody,
				attachments,
				subMultiType === 'related' ? relatedRoot(part) : 0,
			);
		} else if (isInline) {
			// One change from the RFC: where an alternative higher up already dropped the body a part
			// belongs to, the RFC loses the part (or fails on `null.push`); here it is listed instead.
			if (multipartType === 'alternative') {
				const body =
					part.type === 'text/plain' ? textBody : part.type === 'text/html' ? htmlBody : null;
				(body ?? attachments).push(part);
				continue;
			} else if (inAlternative) {
				if (part.type === 'text/plain') htmlBody = null;
				if (part.type === 'text/html') textBody = null;
			}
			textBody?.push(part);
			htmlBody?.push(part);
			const inNeither = !textBody && !htmlBody;
			if (((!textBody || !htmlBody) && isInlineMediaType(part.type)) || inNeither)
				attachments.push(part);
		} else attachments.push(part);
	}
	if (multipartType === 'alternative' && textBody && htmlBody) {
		// Only HTML found: it is the text body too. Only plain text found: the HTML body too.
		if (textLength === textBody.length && htmlLength !== htmlBody.length)
			textBody.push(...htmlBody.slice(htmlLength));
		if (htmlLength === htmlBody.length && textLength !== textBody.length)
			htmlBody.push(...textBody.slice(textLength));
	}
}

/** The RFC 8621 `textBody`, `htmlBody` and `attachments` of a message's MIME tree. */
export function bodyStructure(root: MimePart): BodyStructure {
	const structure: BodyStructure = { textBody: [], htmlBody: [], attachments: [] };
	parseStructure(
		[root],
		'mixed',
		false,
		structure.htmlBody,
		structure.textBody,
		structure.attachments,
	);
	return structure;
}

/** The text of a part in its charset, line breaks normalised to LF as JMAP `bodyValues` are. */
export function partText(part: MimePart): string {
	return decodeCharset(part.body, part.params.charset).replace(/\r\n?/g, '\n');
}

/** Plain text as HTML: markup characters escaped, each line break a `<br>`. */
export const textToHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`).replace(/\r?\n/g, '<br>');

function documentOrder(root: MimePart): Map<MimePart, number> {
	const order = new Map<MimePart, number>();
	const visit = (part: MimePart): void => {
		order.set(part, order.size);
		part.parts.forEach(visit);
	};
	visit(root);
	return order;
}

/**
 * What a reader shows: the plain text parts of the text body joined, the HTML body (its plain
 * text parts, if any, escaped into it) when it has an HTML part, and every part to list as an
 * attachment in message order. Those are RFC 8621's attachments plus images, audio and video shown
 * between the bodies, which string bodies could not carry and would otherwise lose.
 */
export function messageBodies(root: MimePart): MessageBodies {
	const { textBody, htmlBody, attachments } = bodyStructure(root);
	let text: string | null = null;
	for (const part of textBody) {
		if (part.type !== 'text/plain') continue;
		const value = partText(part);
		text = text === null ? value : `${text}${text.endsWith('\n') ? '' : '\n'}${value}`;
	}
	const html = htmlBody.some((part) => part.type === 'text/html')
		? htmlBody
				.filter((part) => part.type === 'text/html' || part.type === 'text/plain')
				.map((part) =>
					part.type === 'text/html' ? partText(part) : `<div>${textToHtml(partText(part))}</div>`,
				)
				.join('')
		: null;
	const order = documentOrder(root);
	const shown = [...textBody, ...htmlBody].filter((part) => isInlineMediaType(part.type));
	const all = [...new Set([...attachments, ...shown])].sort(
		(a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
	);
	return { text, html, attachments: all };
}
