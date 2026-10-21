import { html } from 'lit';
import { TeamsElement } from '../teams/base';
import { LocaleLitElement } from './locale-element';
import { LOCALE_HOST, type LocaleHost } from './locale-host';

/** A locale host on each base the product elements use: the mail and Teams app one, the Teams one. */
class LitChild extends LocaleLitElement {
	override render() {
		return html`${this.locale}`;
	}
}
class TeamsChild extends TeamsElement {
	override render() {
		return html`${this.locale}`;
	}
}

/** Renders a child of each base that follows it, and one of each given its own locale. */
class Host extends LocaleLitElement {
	override render() {
		return html`<locale-lit-child class="follows"></locale-lit-child
			><locale-teams-child class="follows"></locale-teams-child
			><locale-lit-child class="own" locale="es"></locale-lit-child
			><locale-teams-child class="own" locale="es"></locale-teams-child>`;
	}
}

/** A host made by another build of this module (one copy each on a page), as such a host does. */
class OtherBuildHost extends HTMLElement {
	static build: typeof import('./locale-host');
	readonly renderRoot = this.attachShadow({ mode: 'open' });
	private own = '';
	get [LOCALE_HOST](): true {
		return true;
	}
	get locale(): string {
		return this.own;
	}
	set locale(value: string) {
		this.own = value;
		OtherBuildHost.build.pushLocale(this as unknown as LocaleHost);
	}
}

const TAGS = {
	'locale-lit-child': LitChild,
	'locale-teams-child': TeamsChild,
	'locale-test-host': Host,
	'locale-other-build-host': OtherBuildHost,
};

beforeAll(async () => {
	// A second copy of the module (the query makes it another module), as a second build on a page.
	const copy = './locale-host?other-build';
	OtherBuildHost.build = (await import(/* @vite-ignore */ copy)) as typeof import('./locale-host');
	for (const [tag, element] of Object.entries(TAGS))
		if (!customElements.get(tag)) customElements.define(tag, element);
});
afterEach(() => document.body.replaceChildren());

type Child = LocaleHost & { updateComplete: Promise<unknown> };

/** Let `host` and the elements in its shadow root finish their updates. */
async function settle(host: Element): Promise<void> {
	for (let round = 0; round < 3; round++) {
		await (host as Partial<Child>).updateComplete;
		for (const el of host.shadowRoot!.querySelectorAll('*')) await (el as Child).updateComplete;
	}
}

async function mount(locale = ''): Promise<Host> {
	const host = document.createElement('locale-test-host') as Host;
	if (locale) host.locale = locale;
	document.body.append(host);
	await settle(host);
	return host;
}

const children = (host: Element, kind: 'follows' | 'own'): Child[] => [
	...host.shadowRoot!.querySelectorAll<Child>(`.${kind}`),
];
/** The locale of each child of `kind`, and the text it shows in it. */
const shown = (host: Element, kind: 'follows' | 'own') =>
	children(host, kind).map((el) => [el.locale, el.shadowRoot!.textContent]);

describe('locale inheritance', () => {
	it('keeps a locale set on a rendered element through every change of its host', async () => {
		const host = await mount();
		const own = [
			['es', 'es'],
			['es', 'es'],
		];
		expect(shown(host, 'own')).toEqual(own);
		for (const locale of ['de', 'fr', '']) {
			host.locale = locale;
			await settle(host);
			expect(shown(host, 'own'), locale).toEqual(own);
			expect(shown(host, 'follows'), locale).toEqual([
				[locale, locale],
				[locale, locale],
			]);
		}
	});

	it('keeps a locale set on an element that equals the one it inherited', async () => {
		const host = await mount('de');
		const followers = children(host, 'follows');
		for (const el of followers) el.locale = 'de';
		host.locale = 'fr';
		await settle(host);
		expect(followers.map((el) => el.locale)).toEqual(['de', 'de']);
	});

	it('takes the host locale again at once when its own is cleared, and follows it from then on', async () => {
		const host = await mount('de');
		const own = children(host, 'own');
		for (const el of own) el.locale = '';
		await settle(host);
		expect(shown(host, 'own')).toEqual([
			['de', 'de'],
			['de', 'de'],
		]);
		host.locale = 'fr';
		await settle(host);
		expect(own.map((el) => el.locale)).toEqual(['fr', 'fr']);
	});

	it('follows the host it is moved to, unless it has a locale of its own', async () => {
		const first = await mount('de');
		const second = await mount('fr');
		const moved = [...children(first, 'follows'), ...children(first, 'own')];
		second.shadowRoot!.append(...moved);
		await settle(second);
		expect(moved.map((el) => el.locale)).toEqual(['fr', 'fr', 'es', 'es']);
	});

	it('agrees with a host of another build on which elements follow it', async () => {
		const host = document.createElement('locale-other-build-host') as OtherBuildHost;
		document.body.append(host);
		host.locale = 'de';
		const [follower, own] = ['locale-lit-child', 'locale-teams-child'].map(
			(tag) => document.createElement(tag) as Child,
		);
		own!.locale = 'es';
		host.renderRoot.append(follower!, own!);
		await Promise.all([follower!.updateComplete, own!.updateComplete]);
		expect([follower!.locale, own!.locale]).toEqual(['de', 'es']);
		host.locale = 'fr';
		await Promise.all([follower!.updateComplete, own!.updateComplete]);
		expect([follower!.locale, own!.locale]).toEqual(['fr', 'es']);
		// The copy really is another module, with state of its own.
		expect(OtherBuildHost.build.pushLocale).not.toBe((await import('./locale-host')).pushLocale);
	});
});
