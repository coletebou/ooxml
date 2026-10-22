// @vitest-environment jsdom
import { cleanCss, emailDocument, sanitizeEmailHtml, sanitizeMessageHtml } from './sanitize';

const STYLE = {
	font: 'system-ui',
	fontSize: '14px',
	color: '#222',
	background: '#fff',
	link: '#06c',
	quote: '#ccc',
};

const clean = (html: string, allowRemote = false, cidUrls?: Map<string, string>) =>
	sanitizeEmailHtml(html, { allowRemote, ...(cidUrls ? { cidUrls } : {}) });

/** The attributes of `element`, by name. */
const attributesOf = (element: Element): Record<string, string> =>
	Object.fromEntries([...element.attributes].map(({ name, value }) => [name, value]));

/**
 * The frame's document for a message, cleaned, and the attributes its body (`attributes`) and its
 * html element (`root`) have there.
 */
function frame(html: string, allowRemote = false, cidUrls?: Map<string, string>) {
	const content = clean(html, allowRemote, cidUrls);
	const doc = new DOMParser().parseFromString(
		emailDocument(content, allowRemote, STYLE),
		'text/html',
	);
	return {
		content,
		doc,
		attributes: attributesOf(doc.body),
		root: attributesOf(doc.documentElement),
	};
}

/**
 * The colours the frame's own style rules (its first style element) give `element` of `doc`, read
 * with the rules' own selectors.
 */
function frameColours(doc: Document, element: Element): string[] {
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(doc.querySelector('style')?.textContent ?? '');
	return [...sheet.cssRules]
		.filter((rule): rule is CSSStyleRule => 'selectorText' in rule)
		.filter((rule) => element.matches(rule.selectorText))
		.flatMap((rule) => [...rule.style])
		.filter((name) => /color/.test(name));
}

describe('sanitizeEmailHtml', () => {
	it('removes scripts, event handlers and javascript: links', () => {
		const { body } = clean(
			'<p onclick="steal()">Hi<script>steal()</script></p><img src="x" onerror="steal()"><a href="javascript:steal()">x</a><svg onload="steal()"></svg>',
		);
		expect(body).not.toMatch(/script|onclick|onerror|onload|javascript:|<svg/i);
		expect(body).toContain('Hi');
	});

	it('removes forms, controls, frames and plugins but keeps their text', () => {
		const { body } = clean(
			'<form action="https://evil.example"><input name="pw"><button>Log in</button>Text</form><iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example">',
		);
		expect(body).not.toMatch(/<form|<input|<button|<iframe|<object|<embed|<meta|<base/i);
		expect(body).toContain('Text');
		expect(body).toContain('Log in');
	});

	it('blocks remote images, backgrounds and CSS and counts them', () => {
		const result = clean(
			'<html><head><style>@import url(https://evil.example/a.css); body{background:url("https://t.example/b.png")}</style></head><body><img src="https://t.example/pixel.gif" alt="logo"><table background="http://t.example/bg.png"><tr><td style="background-image:url(https://t.example/c.png)">x</td></tr></table></body></html>',
		);
		expect(result.blocked).toBe(4);
		expect(result.body).not.toContain('t.example');
		expect(result.body).toContain('alt="logo"');
		expect(result.sheets).toHaveLength(1);
		expect(result.sheets[0]).not.toMatch(/@import|evil\.example|t\.example/);
		expect(result.sheets[0]).toContain('background:none');
	});

	it('loads remote resources once the person allows them', () => {
		const result = clean('<img src="https://t.example/pixel.gif">', true);
		expect(result.blocked).toBe(0);
		expect(result.body).toContain('src="https://t.example/pixel.gif"');
	});

	it('points cid: images at the attachments and drops unknown ones', () => {
		const cids = new Map([['logo@x', 'blob:http://localhost/1']]);
		const { body } = clean('<img src="cid:logo@x"><img src="cid:missing@x">', false, cids);
		expect(body).toContain('src="blob:http://localhost/1"');
		expect(body.match(/src=/g)).toHaveLength(1);
	});

	it('keeps data: images and drops other data and relative sources', () => {
		const { body } = clean(
			'<img src="data:image/png;base64,iVBORw0KGgo="><img src="data:text/html;base64,PHNjcmlwdD4="><img src="local.png">',
		);
		expect(body).toContain('data:image/png');
		expect(body).not.toContain('data:text/html');
		expect(body).not.toContain('local.png');
	});

	it('opens links in a new tab without an opener', () => {
		const { body } = clean(
			'<a href="https://example.com/x">x</a><a href="mailto:ada@example.com">m</a>',
		);
		expect(body).toContain('target="_blank"');
		expect(body).toContain('rel="noopener noreferrer"');
		expect(body).toContain('mailto:ada@example.com');
	});

	it('opens every link a click follows in a new tab without an opener, image map areas too', () => {
		// The area covers the picture: with `rel="opener"` the page it opens could send this tab to
		// another address, and `target="_self"` would show that page in place of the message.
		const { body } = clean(
			'<img usemap="#m" src="data:image/png;base64,iVBORw0KGgo="><map name="m"><area shape="rect" coords="0,0,9999,9999" href="https://attacker.example/" rel="opener" target="_self"></map><a href="https://example.com/" rel="opener" target="_top">x</a><math href="https://attacker.example/"><mi>m</mi></math><svg><a href="https://attacker.example/"><text>s</text></a></svg>',
		);
		const links = [
			...new DOMParser().parseFromString(body, 'text/html').querySelectorAll('[href]'),
		];
		expect(links.map((link) => link.tagName)).toEqual(['AREA', 'A']);
		for (const link of links) {
			expect(link.getAttribute('target'), link.tagName).toBe('_blank');
			expect(link.getAttribute('rel'), link.tagName).toBe('noopener noreferrer');
		}
	});

	it('cannot be broken out of the style element', () => {
		const result = clean('<style>p{color:red}</style><p>x</p>');
		const doc = emailDocument(
			{ ...result, sheets: ['</style><script>alert(1)</script>'] },
			false,
			STYLE,
		);
		expect(doc).not.toContain('</style><script>');
	});

	it('cannot be broken out of the style element by an end tag a removal would join', () => {
		const payloads = [
			'</sty</stylele><meta http-equiv="refresh" content="0;url=https://evil.example"><b>x</b>',
			'<</style><b>x</b>',
			'</STYLE ><b>x</b>',
			'</sTyLe/><b>x</b>',
		];
		for (const css of payloads) {
			const doc = new DOMParser().parseFromString(
				emailDocument({ sheets: [css], body: '<p>x</p>' }, false, STYLE),
				'text/html',
			);
			expect(doc.querySelector('meta[http-equiv="refresh"]'), css).toBeNull();
			expect(doc.querySelectorAll('b'), css).toHaveLength(0);
			expect(doc.querySelectorAll('style'), css).toHaveLength(2);
			expect(doc.body.innerHTML, css).toBe('<p>x</p>');
		}
	});

	it('keeps what the styles say while keeping them in their element', () => {
		// `\/` is `/` to CSS, so the string still reads `</style></p>`; a comment opened right after
		// `<` stays a comment, so nothing it holds turns into CSS.
		const css = 'p::after{content:"</style></p>"}a{color:red}</*url(https://t.example/p)*/';
		const doc = new DOMParser().parseFromString(
			emailDocument({ sheets: [css], body: '' }, false, STYLE),
			'text/html',
		);
		expect(doc.querySelectorAll('style')[1]!.textContent).toBe(
			'p::after{content:"<\\/style></p>"}a{color:red}</*url(https://t.example/p)*/',
		);
	});

	it('finds cid images whose URL escapes characters of the Content-ID', () => {
		const cids = new Map([
			['foo4%foo1@bar.net', 'blob:http://localhost/1'],
			['50%off@x', 'blob:http://localhost/2'],
			['a%41@x', 'blob:http://localhost/3'],
		]);
		// RFC 2392: the URL is percent-encoded; a malformed escape, or a sender that did not encode
		// at all, is read as written.
		const { body, cids: shown } = clean(
			'<img src="cid:foo4%25foo1@bar.net"><img src="cid:50%off@x"><img src="cid:a%41@x">',
			false,
			cids,
		);
		expect(body).toContain('src="blob:http://localhost/1"');
		expect(body).toContain('src="blob:http://localhost/2"');
		expect(body).toContain('src="blob:http://localhost/3"');
		expect(shown).toEqual(expect.arrayContaining(['foo4%foo1@bar.net', '50%off@x', 'a%41@x']));
	});

	it('keeps the rules of each style element to itself', () => {
		// Each is a sheet of its own, closed at its end: what one leaves open cannot take in the
		// next one's rules.
		const { sheets } = clean(
			'<style>p{color:red</style><style>q{color:green}/* note</style><style>b{color:blue}</style><p>x</p>',
		);
		expect(sheets).toEqual(['p{color:red}', 'q{color:green}/* note*/', 'b{color:blue}']);
	});

	it('keeps the media a style element applies to, and the frame applies its sheet only there', () => {
		const { content, doc } = frame(
			'<style media="print">.screen{display:none}</style><style>p{color:red}</style>' +
				'<style media=\'screen and (min-width:"1px")\'>b{}</style><p class="screen">x</p>',
		);
		expect(content.sheets).toEqual(['.screen{display:none}', 'p{color:red}', 'b{}']);
		expect(content.sheetMedia).toEqual(['print', '', 'screen and (min-width:"1px")']);
		const styles = [...doc.querySelectorAll('style')].slice(1);
		expect(styles.map((style) => style.getAttribute('media'))).toEqual([
			'print',
			null,
			'screen and (min-width:"1px")',
		]);
		expect(styles.map((style) => style.textContent)).toEqual(content.sheets);
		// A part sent on its own keeps the media of its own style elements.
		const parts = ['<style media="print">i{}</style><p>a</p>', '<style>u{}</style><p>b</p>'];
		const joined = sanitizeMessageHtml(
			{ html: parts.join(''), htmlParts: parts },
			{ allowRemote: false },
		);
		expect(joined.sheetMedia).toEqual(['print', '']);
	});

	it('names the cid parts the body and its styles load, found or not', () => {
		const { cids } = clean(
			'<style>p{background:url(cid:Back@X)}</style><p>x</p><img src="cid:logo@x"><a href="cid:file@x">file</a>',
		);
		expect([...cids].sort()).toEqual(['back@x', 'logo@x']);
	});

	it('counts and drops the remote images CSS loads however it is written', () => {
		const result = clean(
			`<p style="background:image-set('https://t.example/a.png' 1x, 'https://t.example/b.png' 2x)">a</p><p style="background:\\75 rl(https://t.example/c.png)">b</p><p style="background:url('https://t.example/d(1).png')">c</p>`,
		);
		expect(result.blocked).toBe(4);
		expect(result.body).not.toContain('t.example');
		expect(result.body).toContain('background:none');
	});

	it('keeps local images in CSS and loads remote ones once allowed', () => {
		const cidUrls = new Map([['logo@x', 'blob:http://localhost/1']]);
		const css =
			'a{background:image-set("cid:logo@x" 1x)}b{background:url(data:image/png;base64,AAAA)}c{background:image-set("https://t.example/c.png" 1x)}';
		const html = `<style>${css}</style><p>x</p>`;
		expect(sanitizeEmailHtml(html, { allowRemote: false, cidUrls }).sheets).toEqual([
			'a{background:image-set("blob:http://localhost/1" 1x)}b{background:url("data:image/png;base64,AAAA")}c{background:none}',
		]);
		const allowed = sanitizeEmailHtml(html, { allowRemote: true, cidUrls });
		expect(allowed.sheets[0]).toContain('c{background:image-set("https://t.example/c.png" 1x)}');
		expect(allowed.blocked).toBe(0);
	});

	it('keeps the style of the body itself, cleaned as the style of every element is', () => {
		// Without its own background, the light text would be shown on the light paper.
		const message = frame('<body style="background:#000"><p style="color:#fff">Message</p></body>');
		expect(message.attributes).toEqual({ style: 'background:#000' });
		expect(message.doc.body.innerHTML).toBe('<p style="color:#fff">Message</p>');
		// What the body keeps of a style is what a paragraph keeps of the same one.
		const css = 'color:#fff;background:url(https://t.example/a.png);width:expression(alert(1))';
		const both = frame(`<body style="${css}"><p style="${css}">x</p></body>`);
		expect(both.attributes.style).toBe(both.doc.querySelector('p')!.getAttribute('style'));
		expect(both.attributes.style).toBe('color:#fff;background:none;width:x-blocked(alert(1))');
		expect(both.content.blocked).toBe(2);
	});

	it('keeps the colours the attributes of the body give it, and the frame gives way to them', () => {
		const message = frame(
			'<body bgcolor="000000" text="#ffffff" link="#ffcc00" vlink="#cc99ff" alink="red" leftmargin="0"><p>x <a href="https://example.com/">a link</a></p></body>',
		);
		// Not its margin: the frame keeps its own spacing round a message.
		expect(message.attributes).toEqual({
			bgcolor: '000000',
			text: '#ffffff',
			link: '#ffcc00',
			vlink: '#cc99ff',
			alink: 'red',
		});
		// A browser reads them as presentational hints, which every style rule wins over: the frame's
		// own colours stand back where the body gives its own.
		expect(frameColours(message.doc, message.doc.body)).toEqual([]);
		expect(frameColours(message.doc, message.doc.querySelector('a')!)).toEqual([]);
		// A body without colours of its own is shown in the paper's.
		const plain = frame('<p>x <a href="https://example.com/">a link</a></p>');
		expect(frameColours(plain.doc, plain.doc.body)).toEqual(['color', 'background-color']);
		expect(frameColours(plain.doc, plain.doc.querySelector('a')!)).toEqual(['color']);
		// So is one whose colours a browser does not read as any: they go, and the paper's stay.
		const refused = frame('<body bgcolor=" Transparent " text=""><p>x</p></body>');
		expect(refused.attributes).toEqual({});
		expect(frameColours(refused.doc, refused.doc.body)).toEqual(['color', 'background-color']);
	});

	it('blocks and counts a remote picture of the body until remote content is allowed', () => {
		const html =
			'<body background="https://t.example/bg.png" style="background-image:url(https://t.example/b.png)"><p>x</p></body>';
		const blocked = frame(html);
		expect(blocked.content.blocked).toBe(2);
		expect(blocked.attributes).toEqual({ style: 'background-image:none' });
		const allowed = frame(html, true);
		expect(allowed.content.blocked).toBe(0);
		expect(allowed.attributes).toEqual({
			style: 'background-image:url("https://t.example/b.png")',
			background: 'https://t.example/bg.png',
		});
		// A picture of the message's own shows from the part it names.
		const cidUrls = new Map([['back@x', 'blob:http://localhost/1']]);
		const own = frame('<body background="cid:Back@X"><p>x</p></body>', false, cidUrls);
		expect(own.attributes).toEqual({ background: 'blob:http://localhost/1' });
		expect(own.content.cids).toEqual(['back@x']);
	});

	it('lets nothing run or load from the body, nor leave the attribute it is in', () => {
		const message = frame(
			`<body onload="steal()" onclick="steal()" background="javascript:steal()" link="javascript:steal()" id="cookie" bgcolor='#000" onload="steal()' class='a" onload="steal()' style='color:#fff;background:url("javascript:steal()")'><p>x</p></body>`,
		);
		// Only what styles a body is taken from it; what is unsafe in that goes as it goes anywhere
		// else, and what stays stays in its own attribute.
		expect(message.attributes).toEqual({
			style: 'color:#fff;background:none',
			class: 'a" onload="steal()',
			bgcolor: '#000" onload="steal()',
		});
		expect(message.doc.querySelectorAll('script, [onload], [onclick]')).toHaveLength(0);
		// A value that would end the attribute's element goes, as it does on every element.
		const ending = frame('<body style="color:red</style><b>x</b>" class="--></b>"><p>x</p></body>');
		expect(ending.attributes).toEqual({});
		expect(ending.doc.body.innerHTML).toBe('<p>x</p>');
	});

	it('keeps the direction and language of the message and of its body', () => {
		// Without them a message written right to left is shown left to right, and a screen reader
		// reads it in the wrong language.
		const message = frame(
			'<html dir="rtl" lang="ar"><body dir="auto" lang="he"><p>x</p></body></html>',
		);
		expect(message.content.htmlAttributes).toEqual({ dir: 'rtl', lang: 'ar' });
		expect(message.root).toEqual({ dir: 'rtl', lang: 'ar' });
		expect(message.attributes).toEqual({ dir: 'auto', lang: 'he' });
		// A message that gives neither is shown as before.
		expect(frame('<p>x</p>').root).toEqual({});
	});

	it('keeps what styles the html element of the message, cleaned as on every element', () => {
		const html =
			'<html style="background:url(https://t.example/a.png);color:#333" class="m" id="note" onload="steal()" manifest="https://t.example/m" xmlns="http://www.w3.org/1999/xhtml"><p>x</p></html>';
		// Its style, class and id, as an element of its body keeps them; nothing else it names.
		const blocked = frame(html);
		expect(blocked.root).toEqual({ style: 'background:none;color:#333', class: 'm', id: 'note' });
		expect(blocked.content.blocked).toBe(1);
		const allowed = frame(html, true);
		expect(allowed.root).toEqual({
			style: 'background:url("https://t.example/a.png");color:#333',
			class: 'm',
			id: 'note',
		});
		expect(allowed.content.blocked).toBe(0);
		// What is unsafe goes as it does anywhere: an id that names a property of the document, a
		// value that would end the attribute's element.
		expect(frame('<html id="cookie" lang="en</style><b>x</b>"><p>x</p></html>').root).toEqual({});
	});

	it('stays fast on hostile CSS', () => {
		const started = performance.now();
		cleanCss('url('.repeat(50_000));
		cleanCss('@import '.repeat(50_000));
		expect(performance.now() - started).toBeLessThan(3000);
	});
});

describe('cleanCss', () => {
	it('blocks every way CSS can load a remote resource', () => {
		// Each of these loads from t.example in a browser; a url() pattern alone misses them.
		const cases: [css: string, cleaned: string][] = [
			["background:image-set('https://t.example/a.png' 1x)", 'background:none'],
			[
				'background:-webkit-image-set("https://t.example/a.png" 1x, "https://t.example/b.png" 2x)',
				'background:none',
			],
			["background:image('https://t.example/a.png')", 'background:none'],
			[
				"background:cross-fade('https://t.example/a.png' 50%, url(https://t.example/b.png))",
				'background:none',
			],
			['background:imag\\65-set("https://t.example/a.png" 1x)', 'background:none'],
			['background:src("https://t.example/a.png")', 'background:none'],
			['background:url("https://t.example/a(1).png")', 'background:none'],
			["background:url('https://t.example/it\\'s.png')", 'background:none'],
			[`background:url(https://t.example/${'a'.repeat(5000)}.png)`, 'background:none'],
			['background:url(https://t.example/a.png', 'background:none'],
			['background:url("https://t.example/a.png', 'background:none'],
			['background:\\75 rl(https://t.example/a.png)', 'background:none'],
			['background:U\\52L( "https://t.example/a.png" )', 'background:none'],
			// `<!--` is a token of its own, so the name after it is a function of its own.
			['background:<!--url(https://t.example/a.png)', 'background:<!--none'],
			['background:<!--image-set("https://t.example/a.png" 1x)', 'background:<!--none'],
			[
				'--u:"https://t.example/a.png";background:image-set(var(--u) 1x)',
				'--u:"https://t.example/a.png";background:none',
			],
		];
		for (const [css, cleaned] of cases) expect(cleanCss(css), css.slice(0, 80)).toBe(cleaned);
	});

	it('blocks the old script-like properties without swallowing the rules after them', () => {
		// An unclosed function would take every rule after it (CSS Syntax: up to its `)` or the end).
		const cases: [css: string, cleaned: string][] = [
			['a{behavior:url(x.htc)}b{color:red}', 'a{x-blocked:none}b{color:red}'],
			['a{-moz-binding:url(x.xml#b)}b{color:red}', 'a{x-blocked:none}b{color:red}'],
			[
				'a{background:javascript:alert(1)}b{color:red}',
				'a{background:x-blocked:alert(1)}b{color:red}',
			],
			['a{width:expression(alert(1))}b{color:red}', 'a{width:x-blocked(alert(1))}b{color:red}'],
			// Only the old property itself: `scroll-behavior` is a property of its own.
			['a{scroll-behavior:smooth}b{color:red}', 'a{scroll-behavior:smooth}b{color:red}'],
		];
		for (const [css, cleaned] of cases) expect(cleanCss(css), css).toBe(cleaned);
	});

	it('drops @import however it is written', () => {
		expect(cleanCss('@import "https://t.example/a.css";p{color:red}')).toBe('p{color:red}');
		expect(cleanCss('@\\69mport "https://t.example/a.css";p{color:red}')).toBe('p{color:red}');
		expect(cleanCss('@import url(https://t.example/a.css) screen;p{color:red}')).toBe(
			'p{color:red}',
		);
	});

	it('never lets the text on either side of what it removes join into a resource', () => {
		// Joined, each pair reads as a new token the first pass never saw: `url(`, `\75 ` (u),
		// a comment that turns the string after it into CSS, or an @import.
		const cases: [css: string, cleaned: string][] = [
			[
				'background:u@import;rl(https://t.example/pixel)',
				'background:u/**/rl(https://t.example/pixel)',
			],
			[
				'background:\\7@import;5 rl(https://t.example/pixel)',
				'background:\\7/**/5 rl(https://t.example/pixel)',
			],
			[
				'background:\\75 @import;rl(https://t.example/pixel)',
				'background:\\75 /**/rl(https://t.example/pixel)',
			],
			[
				'background:u@import;\\72 l(https://t.example/pixel)',
				'background:u/**/\\72 l(https://t.example/pixel)',
			],
			[
				'background:url@import;(https://t.example/pixel)',
				'background:url/**/(https://t.example/pixel)',
			],
			[
				'background:image@import;-set("https://t.example/a.png" 1x)',
				'background:image/**/-set("https://t.example/a.png" 1x)',
			],
			[
				'background:s@import x;rc("https://t.example/a.png")',
				'background:s/**/rc("https://t.example/a.png")',
			],
			[
				'background:u@import;@import;rl(https://t.example/pixel)',
				'background:u/**/rl(https://t.example/pixel)',
			],
			[
				'color:red/@import;*"*/;background:url(https://t.example/pixel);x:"',
				'color:red//**/*"*/;background:url(https://t.example/pixel);x:"',
			],
			[
				'@@import;import "https://t.example/a.css";p{color:red}',
				'@/**/import "https://t.example/a.css";p{color:red}',
			],
			[
				'@\\69@import;mport "https://t.example/a.css";p{color:red}',
				'@\\69/**/mport "https://t.example/a.css";p{color:red}',
			],
			['margin:1@import;0px', 'margin:1/**/0px'],
			// What replaces a blocked function never runs on into the name or block after it.
			[
				'background:image-set("https://t.example/a.png" 1x)rl(https://t.example/pixel)',
				'background:none/**/rl(https://t.example/pixel)',
			],
			['background:url(https://t.example/a.png)(x)', 'background:none/**/(x)'],
		];
		for (const [css, cleaned] of cases) expect(cleanCss(css), css).toBe(cleaned);
	});

	it('adds nothing where the text around a removal cannot join', () => {
		const cases: [css: string, cleaned: string][] = [
			['p{color:red}@import "https://t.example/a.css";p{}', 'p{color:red}p{}'],
			['p{}\n@import "https://t.example/a.css";\np{}', 'p{}\n\np{}'],
			['p{color:red;@import "https://t.example/a.css";}', 'p{color:red;}'],
			['background:url(https://t.example/a.png) no-repeat', 'background:none no-repeat'],
			['background:url(https://t.example/a.png),red', 'background:none,red'],
		];
		for (const [css, cleaned] of cases) expect(cleanCss(css), css).toBe(cleaned);
	});
});

describe('sanitizeMessageHtml', () => {
	const options = { allowRemote: false };
	/** The text a cleaned body shows. */
	const shown = (body: string): string =>
		new DOMParser().parseFromString(body, 'text/html').body.textContent ?? '';

	it('cleans each part of a body sent in several on its own', () => {
		// Read as one text, the open comment and the open attribute would take in what follows.
		const htmlParts = ['<p>Hello<!--', '<div>Footer</div>', '<p title="x>Lost', '<p>Bye</p>'];
		const html = htmlParts.join('');
		expect(shown(sanitizeEmailHtml(html, options).body)).toBe('Hello');
		const { body } = sanitizeMessageHtml({ html, htmlParts }, options);
		expect(shown(body)).toBe('HelloFooterBye');
		// The parts are the body: `html` is not shown a second time.
		expect(shown(sanitizeMessageHtml({ html: '<p>Other</p>', htmlParts }, options).body)).toBe(
			'HelloFooterBye',
		);
	});

	it('cleans every part, and keeps the styles of each', () => {
		const htmlParts = [
			'<style>p{color:red}</style><p>a</p>',
			'<style>b{background:url(https://t.example/b.png)}</style><b onclick="steal()">b</b><script>steal()</script>',
		];
		const result = sanitizeMessageHtml({ html: htmlParts.join(''), htmlParts }, options);
		expect(result.body).toBe('<p>a</p><b>b</b>');
		expect(result.sheets).toEqual(['p{color:red}', 'b{background:none}']);
		// What the styles of one part leave open never takes in those of the next.
		const open = ['<style>p::after{content:"a\\</style><p>a</p>', '<style>b{color:blue}</style>'];
		expect(sanitizeMessageHtml({ html: open.join(''), htmlParts: open }, options).sheets).toEqual([
			'p::after{content:"a"}',
			'b{color:blue}',
		]);
	});

	it('adds up what each part blocked and names the cid parts of all of them', () => {
		const htmlParts = [
			'<img src="https://t.example/a.png"><img src="cid:logo@x"><!--',
			'<img src="https://t.example/b.png"><img src="cid:Logo@x"><p style="background:url(cid:back@x)">x</p>',
		];
		const cidUrls = new Map([['back@x', 'blob:http://localhost/1']]);
		const result = sanitizeMessageHtml(
			{ html: htmlParts.join(''), htmlParts },
			{ allowRemote: false, cidUrls },
		);
		expect(result.blocked).toBe(2);
		expect(result.cids).toEqual(['logo@x', 'back@x']);
		expect(result.body).toContain('blob:http://localhost/1');
	});

	it('styles the body as one document of its parts would, cleaning only what it takes', () => {
		// A parser gives a body the attributes of a later `<body>` tag only where it has none of its
		// own: the first part whose body has an attribute gives it, and the parts after it only add.
		const htmlParts = [
			'<body bgcolor="#000000" style="color:#fff" background="https://t.example/a.png"><p>a</p>',
			'<body bgcolor="#ffffff" text="#eeeeee" style="color:red" background="https://t.example/b.png"><p>b</p>',
			'<p>c</p><body link="#ffcc00" text="#000000">',
		];
		const message = { html: htmlParts.join(''), htmlParts };
		const blocked = sanitizeMessageHtml(message, options);
		expect(blocked.bodyAttributes).toEqual({
			style: 'color:#fff',
			bgcolor: '#000000',
			text: '#eeeeee',
			link: '#ffcc00',
		});
		// The first part's picture is the body's, so it is the only one counted, and loaded once
		// allowed.
		expect(blocked.blocked).toBe(1);
		const allowed = sanitizeMessageHtml(message, { allowRemote: true });
		expect(allowed.bodyAttributes).toEqual({
			...blocked.bodyAttributes,
			background: 'https://t.example/a.png',
		});
	});

	it('gives the message the direction and language its parts read as one document give it', () => {
		// As for the body, a parser gives the html element the attributes of a later `<html>` tag only
		// where it has none of its own.
		const htmlParts = [
			'<html dir="rtl"><body lang="ar"><p>a</p>',
			'<html dir="ltr" lang="en"><body dir="ltr" lang="fr"><p>b</p>',
		];
		// (jsdom's parser replaces them instead, so a browser test compares with a browser's parse.)
		const result = sanitizeMessageHtml({ html: htmlParts.join(''), htmlParts }, options);
		expect(result.htmlAttributes).toEqual({ dir: 'rtl', lang: 'en' });
		expect(result.bodyAttributes).toEqual({ lang: 'ar', dir: 'ltr' });
	});

	it('cleans a body in one part as sanitizeEmailHtml does', () => {
		const html =
			'<style>p{background:url(https://t.example/p.png)}</style><p>Hi<img src="cid:logo@x"><img src="https://t.example/i.png"></p>';
		const cidUrls = new Map([['logo@x', 'blob:http://localhost/1']]);
		for (const allowRemote of [false, true]) {
			const expected = sanitizeEmailHtml(html, { allowRemote, cidUrls });
			expect(sanitizeMessageHtml({ html }, { allowRemote, cidUrls })).toEqual(expected);
			expect(sanitizeMessageHtml({ html, htmlParts: [] }, { allowRemote, cidUrls })).toEqual(
				expected,
			);
		}
		expect(sanitizeMessageHtml({ html: null }, options)).toEqual(sanitizeEmailHtml('', options));
	});
});

describe('emailDocument', () => {
	it('allows only inline styles and local images until remote content is allowed', () => {
		const content = clean('<p>x</p>');
		const blocked = emailDocument(content, false, STYLE);
		expect(blocked).toContain("default-src 'none'");
		expect(blocked).toContain('img-src data: blob:;');
		expect(blocked).not.toContain('https:');
		expect(blocked).toContain('<base target="_blank">');
		expect(emailDocument(content, true, STYLE)).toContain('img-src data: blob: https: http:;');
	});

	it('writes each sheet in a style element of its own that it cannot leave', () => {
		// The end of one sheet and the start of the next would make an end tag between them.
		const sheets = ['p{color:red}<', '/style><b>x</b>', '</sty', 'le><b>y</b>'];
		const doc = new DOMParser().parseFromString(
			emailDocument({ sheets, body: '<p>x</p>' }, false, STYLE),
			'text/html',
		);
		expect([...doc.querySelectorAll('style')].slice(1).map((style) => style.textContent)).toEqual([
			'p{color:red}<',
			'/style><b>x</b>',
			'<\\/sty',
			'le><b>y</b>',
		]);
		expect(doc.querySelectorAll('b')).toHaveLength(0);
		expect(doc.body.innerHTML).toBe('<p>x</p>');
	});

	it('gives its body the attributes that style the message body, and no other', () => {
		const bodyAttributes = {
			style: 'font-family:"A&B"',
			class: '"><b>x</b>',
			bgcolor: '#000',
			onload: 'steal()',
		};
		const doc = new DOMParser().parseFromString(
			emailDocument({ sheets: [], body: '<p>x</p>', bodyAttributes }, false, STYLE),
			'text/html',
		);
		expect(
			Object.fromEntries([...doc.body.attributes].map(({ name, value }) => [name, value])),
		).toEqual({ style: 'font-family:"A&B"', class: '"><b>x</b>', bgcolor: '#000' });
		expect(doc.body.innerHTML).toBe('<p>x</p>');
	});

	it('gives its html element the attributes of the message html element, and no other', () => {
		const htmlAttributes = {
			dir: 'rtl',
			lang: 'ar',
			style: 'font-family:"A&B"',
			class: '"><b>x</b>',
			onload: 'steal()',
		};
		const doc = new DOMParser().parseFromString(
			emailDocument({ sheets: [], body: '<p>x</p>', htmlAttributes }, false, STYLE),
			'text/html',
		);
		expect(attributesOf(doc.documentElement)).toEqual({
			dir: 'rtl',
			lang: 'ar',
			style: 'font-family:"A&B"',
			class: '"><b>x</b>',
		});
		expect(doc.head.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
		expect(doc.body.innerHTML).toBe('<p>x</p>');
	});

	it('names no side of the page in its own rules, so they follow the direction of the message', () => {
		// The bar of a quote is on the side its lines start on: the right, written right to left.
		const own = frame('<blockquote>x</blockquote>').doc.querySelector('style')?.textContent ?? '';
		expect(own).not.toMatch(/\b(?:left|right)\b/);
		expect(own).toContain(
			'blockquote{margin:0;margin-inline-start:.5em;padding-inline-start:.75em;',
		);
	});
});
