import { rewriteCss } from './sanitize-css';

/** The URLs `css` makes a browser load (as `resolve` sees them), and the CSS with all blocked. */
function loads(css: string): { urls: string[]; out: string } {
	const urls: string[] = [];
	const out = rewriteCss(css, (url) => {
		urls.push(url);
		return '';
	});
	return { urls, out };
}

describe('rewriteCss', () => {
	it('hands every URL to resolve as a browser reads it', () => {
		expect(loads('a{background:url(https://t.example/a\\29 .png)}').urls).toEqual([
			'https://t.example/a).png',
		]);
		expect(loads("a{background:url( 'https://t.example/b.png' )}").urls).toEqual([
			'https://t.example/b.png',
		]);
		expect(loads('a{background:image-set("x.png" 1x, url(y.png) 2x)}').urls).toEqual([
			'x.png',
			'y.png',
		]);
		// A carriage return ends a string like a newline does, so what follows is CSS again.
		expect(loads('a{content:"x\rbackground:url(https://t.example/c.png)}').urls).toEqual([
			'https://t.example/c.png',
		]);
	});

	it('writes what resolve returns as a well-formed CSS string', () => {
		const out = rewriteCss('a{background:url(x)}', () => 'data:image/svg+xml,"\\\n<svg/>');
		expect(out).toBe('a{background:url("data:image/svg+xml,\\"\\\\\\a <svg/>")}');
	});

	it('keeps strings that are text, and functions it allows, as they are', () => {
		const text = 'a::after{content:"url(https://example.com)";quotes:"(" ")"}';
		expect(loads(text)).toEqual({ urls: [], out: text });
		const allowed = rewriteCss(
			'a{background:cross-fade(image-set("cid:a" 1x type("image/png")) 50%, url(cid:b) linear-gradient(red, rgb(0 0 0)))}',
			(url) => url.replace('cid:', 'blob:'),
		);
		expect(allowed).toBe(
			'a{background:cross-fade(image-set("blob:a" 1x type("image/png")) 50%, url("blob:b") linear-gradient(red, rgb(0 0 0)))}',
		);
	});

	it('drops an image function whose URL it cannot check', () => {
		for (const value of [
			'image-set(var(--u) 1x)',
			'image-set(attr(title) 1x)',
			'image-set(if(media(print): "https://t.example/a.png") 1x)',
			'image-set({)} "https://t.example/a.png" 1x)',
		])
			expect(loads(`a{background:${value}}`).out, value).toBe('a{background:none}');
		expect(loads('a{background:src(var(--u))}').out).toBe('a{background:none}');
		// Left open, a function runs to the end with the rule's `}` inside it, as in a browser.
		expect(loads('a{background:image-set("https://t.example/a.png" 1x}').out).toBe(
			'a{background:none',
		);
	});

	it('looks inside every function and block an image function holds, at any depth', () => {
		for (const value of [
			'image-set(calc(var(--u)) 1x)',
			'image-set(calc({"https://t.example/p"}) 1x)',
			'image-set(min(1px, calc(max(2px, var(--u)))) 1x)',
			'image-set(linear-gradient(red, rgb(var(--c) 0 0)) 1x)',
			'image-set(type(var(--u)) 1x)',
			'image-set(calc(url(https://t.example/p)) 1x)',
			'cross-fade(image-set(calc([attr(title)]) 1x) 50%, red)',
			'cross-fade(red, calc(image-set(var(--u))))',
			`image-set(${'calc('.repeat(40)}var(--u)${')'.repeat(40)} 1x)`,
		])
			expect(loads(`a{background:${value}}`).out, value).toBe('a{background:none}');
		// A string anywhere in an image function is a URL, and resolve sees it.
		expect(loads('a{background:image-set(calc({"https://t.example/p"}) 1x)}').urls).toEqual([
			'https://t.example/p',
		]);
		expect(loads('a{background:image-set(min(calc("https://t.example/q")) 1x)}')).toEqual({
			urls: ['https://t.example/q'],
			out: 'a{background:none}',
		});
		const cid = (url: string): string => url.replace('cid:', 'blob:');
		expect(rewriteCss('a{b:image-set(calc("cid:a") 1x)}', cid)).toBe(
			'a{b:image-set(calc("blob:a") 1x)}',
		);
		// Only the string of `type()` is a MIME type, and stays as it is.
		expect(rewriteCss('a{b:image-set(linear-gradient(red, blue) 1x type("image/png"))}', cid)).toBe(
			'a{b:image-set(linear-gradient(red, blue) 1x type("image/png"))}',
		);
	});

	it('resolves nothing it drops anyway', () => {
		expect(loads('@import url(https://t.example/a.css) screen;a{b:c}')).toEqual({
			urls: [],
			out: 'a{b:c}',
		});
		expect(loads('a{b:url("x" image-set("https://t.example/a.png" 1x))}')).toEqual({
			urls: ['x'],
			out: 'a{b:none}',
		});
		// A malformed url token loads nothing.
		expect(loads('a{b:url(https://t.example/a"b.png);c:d}')).toEqual({
			urls: [],
			out: 'a{b:none;c:d}',
		});
	});

	it('stays linear on hostile CSS', () => {
		const started = performance.now();
		for (const hostile of [
			'image-set('.repeat(50_000),
			'url("'.repeat(50_000),
			'u\\72l('.repeat(50_000),
			'\\'.repeat(200_000),
			'/*'.repeat(100_000),
			`${'('.repeat(100_000)}${')'.repeat(100_000)}`,
			'@import '.repeat(50_000),
			`url(${'\\29'.repeat(100_000)}`,
		])
			rewriteCss(hostile, () => '');
		expect(performance.now() - started).toBeLessThan(3000);
	});
});
