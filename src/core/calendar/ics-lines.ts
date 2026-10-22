// iCalendar (RFC 5545 section 3.1) content lines and the BEGIN/END tree they form. Unfolding (a
// line break followed by a space or a tab continues the line, after CRLF, LF or CR), the
// `NAME;PARAM=value:VALUE` split with quoted parameter values that may hold `:`, `;` and `,`
// (RFC 6868 caret escapes decoded), and TEXT unescaping. Tolerant: a line that is not a content
// line is counted and skipped, an END without its BEGIN is ignored and a component still open where
// the text ends is closed there. Nothing here throws. vCard (RFC 6350) shares the line format and
// reads its lines through `splitContentLine` and `caretDecode`. DOM-free. New code.

export interface ContentLine {
	/** Upper case. */
	name: string;
	/** Upper-case names; each value unquoted and RFC 6868 decoded, in order. */
	params: Record<string, string[]>;
	/** As written: a TEXT value is still escaped (see `unescapeText`). */
	value: string;
}

export interface Component {
	/** Upper case: `VCALENDAR`, `VEVENT`, `VTIMEZONE`, `STANDARD`, `VALARM`, ... */
	name: string;
	properties: ContentLine[];
	components: Component[];
}

export interface ComponentTree {
	/** The top-level components (normally one VCALENDAR). */
	components: Component[];
	/** Lines that are not content lines, and properties outside every component. */
	unreadable: number;
	/** Components that were still open where they had to be closed: at an outer END or the end. */
	unclosed: string[];
}

/** The logical lines of a text, folded lines joined, a leading byte order mark dropped. */
export function unfoldLines(text: string): string[] {
	const out: string[] = [];
	for (const line of text.replace(/^\uFEFF/u, '').split(/\r\n|\r|\n/u)) {
		if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0)
			out.push(`${out.pop() ?? ''}${line.slice(1)}`);
		else out.push(line);
	}
	return out;
}

/** Split on a separator that is not inside double quotes. */
function splitOutside(text: string, separator: string): string[] {
	const out: string[] = [];
	let current = '';
	let quoted = false;
	for (const ch of text) {
		if (ch === '"') quoted = !quoted;
		if (ch === separator && !quoted) {
			out.push(current);
			current = '';
		} else current += ch;
	}
	out.push(current);
	return out;
}

/** RFC 6868: `^n` is a line break, `^'` a double quote and `^^` a caret. */
export const caretDecode = (value: string): string =>
	value.replace(/\^([n^'])/gu, (_, c: string) => (c === 'n' ? '\n' : c === "'" ? '"' : '^'));

/**
 * `NAME;PARAM=value:VALUE` cut at its first colon outside quotes, the head split at the semicolons
 * outside quotes, nothing trimmed or decoded (iCalendar and vCard read names and parameters
 * differently); null when there is no such colon.
 */
export function splitContentLine(
	line: string,
): { name: string; params: string[]; value: string } | null {
	let colon = -1;
	let quoted = false;
	for (let i = 0; i < line.length && colon < 0; i++) {
		if (line[i] === '"') quoted = !quoted;
		else if (line[i] === ':' && !quoted) colon = i;
	}
	if (colon < 0) return null;
	const [name = '', ...params] = splitOutside(line.slice(0, colon), ';');
	return { name, params, value: line.slice(colon + 1) };
}

const NAME = /^[A-Za-z0-9-]+$/u;

/** One unfolded line, or null when it is not `NAME[;PARAM=VALUE...]:VALUE`. */
export function parseContentLine(line: string): ContentLine | null {
	const parts = splitContentLine(line);
	if (!parts) return null;
	const name = parts.name.trim().toUpperCase();
	if (!NAME.test(name)) return null;
	const params: Record<string, string[]> = {};
	for (const part of parts.params) {
		const eq = part.indexOf('=');
		const key = (eq < 0 ? part : part.slice(0, eq)).trim().toUpperCase();
		if (!NAME.test(key)) continue;
		// A bare parameter (`TEL;WORK:` in old vCards) has no value of its own.
		const values =
			eq < 0
				? []
				: splitOutside(part.slice(eq + 1), ',').map((v) =>
						caretDecode(v.trim().replace(/^"([^"]*)"$/u, '$1')),
					);
		// Appended one by one: copying the values so far for each repeat of a parameter is quadratic,
		// and spreading a long list into `push` can exceed the platform's limit on arguments.
		const held = (params[key] ??= []);
		for (const value of values) held.push(value);
	}
	return { name, params, value: parts.value };
}

/** A TEXT value: `\n` (or `\N`) is a line break; `\\`, `\;`, `\,` and any other `\x` are `x`. */
export const unescapeText = (value: string): string =>
	value.replace(/\\([\s\S])/gu, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

/**
 * The component tree of a text. An END closes the innermost open component of its name, and any
 * still open inside it. Where each name is open is kept by name, so finding it never looks through
 * the components open above it: a text nested tens of thousands deep is read in linear time.
 */
export function readComponents(text: string): ComponentTree {
	const root: Component = { name: '', properties: [], components: [] };
	const stack: Component[] = [root];
	/** The depths on `stack` at which each name is open, innermost last. */
	const open = new Map<string, number[]>();
	const unclosed: string[] = [];
	let unreadable = 0;
	/** Closes the component at depth `at` and, as unclosed, every one still open inside it. */
	const close = (at: number): void => {
		for (let i = at + 1; i < stack.length; i++) unclosed.push(stack[i]!.name);
		for (const closed of stack.splice(at)) open.get(closed.name)?.pop();
	};
	for (const raw of unfoldLines(text)) {
		if (!raw.trim()) continue;
		const line = parseContentLine(raw);
		const top = stack[stack.length - 1] ?? root;
		if (!line) unreadable++;
		else if (line.name === 'BEGIN') {
			const child: Component = {
				name: line.value.trim().toUpperCase(),
				properties: [],
				components: [],
			};
			top.components.push(child);
			const depths = open.get(child.name) ?? [];
			open.set(child.name, depths);
			depths.push(stack.length);
			stack.push(child);
		} else if (line.name === 'END') {
			const at = open.get(line.value.trim().toUpperCase())?.at(-1);
			if (at !== undefined) close(at);
		} else if (top === root) unreadable++;
		else top.properties.push(line);
	}
	for (let i = 1; i < stack.length; i++) unclosed.push(stack[i]!.name);
	return { components: root.components, unreadable, unclosed };
}
