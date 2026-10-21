// @vitest-environment jsdom
import {
	cleanCss,
	emailDocument,
	linkify,
	sanitizeEmailHtml,
	sanitizeMessageHtml,
} from './sanitize';

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
		expect(result.css).not.toMatch(/@import|evil\.example|t\.example/);
		expect(result.css).toContain('background:none');
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

	it('cannot be broken out of the style element', () => {
		const result = clean('<style>p{color:red}</style><p>x</p>');
		const doc = emailDocument(
			{ ...result, css: '</style><script>alert(1)</script>' },
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
				emailDocument({ css, body: '<p>x</p>' }, false, STYLE),
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
			emailDocument({ css, body: '' }, false, STYLE),
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
		expect(sanitizeEmailHtml(html, { allowRemote: false, cidUrls }).css).toBe(
			'a{background:image-set("blob:http://localhost/1" 1x)}b{background:url("data:image/png;base64,AAAA")}c{background:none}',
		);
		const allowed = sanitizeEmailHtml(html, { allowRemote: true, cidUrls });
		expect(allowed.css).toContain('c{background:image-set("https://t.example/c.png" 1x)}');
		expect(allowed.blocked).toBe(0);
	});

	it('stays fast on hostile CSS and long words', () => {
		const started = performance.now();
		cleanCss('url('.repeat(50_000));
		cleanCss('@import '.repeat(50_000));
		linkify('a.'.repeat(100_000));
		linkify(`${'x'.repeat(200_000)}@`);
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
		expect(result.css).toBe('p{color:red}\nb{background:none}');
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
});

describe('linkify', () => {
	it('splits plain text into text and links, never markup', () => {
		expect(
			linkify('See https://example.com/a?b=1. Or www.example.org, or mail ada@example.com!'),
		).toEqual([
			{ text: 'See ' },
			{ text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
			{ text: '. Or ' },
			{ text: 'www.example.org', href: 'https://www.example.org' },
			{ text: ', or mail ' },
			{ text: 'ada@example.com', href: 'mailto:ada@example.com' },
			{ text: '!' },
		]);
		expect(linkify('<b>not markup</b>')).toEqual([{ text: '<b>not markup</b>' }]);
	});
});
