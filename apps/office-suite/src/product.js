import { $, apps, badge, suiteApps, teamsApp } from './ui.js';
export const product = document.body.dataset.product || '';
/**
 * The file kind this page is limited to: a standalone editor's own kind, or '' in the suite and in
 * Teams and Notebook, which open documents of every kind.
 */
export const productKind = apps.some((a) => a.id === product) ? product : '';
export const suiteBase = new URL(
	document.querySelector('meta[name="ooxml-root"]')?.content || './',
	location.href,
);
export const productPaths = {
	docx: 'word',
	xlsx: 'excel',
	pptx: 'powerpoint',
	vsdx: 'visio',
	teams: 'teams',
	notebook: 'notebook',
};
export function workspaceUrl(type, id) {
	const url = new URL(
		/^https?:$/.test(suiteBase.protocol) ? suiteBase : 'https://ooxml.local.invalid/',
	);
	url.hash = `/${type}/${id}`;
	return url.href;
}
export function workspaceId(raw, type) {
	try {
		const url = new URL(raw);
		const base = new URL(workspaceUrl(type, 'base'));
		const paths = [
			base.pathname,
			...Object.values(productPaths).map((p) => new URL(`apps/${p}/`, suiteBase).pathname),
		];
		return url.origin === base.origin &&
			paths.includes(url.pathname) &&
			new RegExp(`^#/${type}/[\\w-]+$`, 'u').test(url.hash)
			? url.hash.slice(type.length + 3)
			: null;
	} catch {
		return null;
	}
}
export function mountProduct() {
	if (!product) {
		const links = document.createElement('details');
		links.className = 'standalone-links';
		links.innerHTML = `<summary>Open apps separately</summary>${suiteApps
			.map((a) => `<a href="${new URL(`apps/${productPaths[a.id]}/`, suiteBase)}">${a.name}</a>`)
			.join('')}`;
		$('app-launcher').append(links);
		return;
	}
	const app = suiteApps.find((a) => a.id === product) ?? teamsApp;
	const brand = document.querySelector('.brand');
	brand.innerHTML = `${badge(product)}<strong>${app.name}</strong>`;
	brand.setAttribute('aria-label', `${app.name} home`);
	// Teams and Notebook buttons name their app in data-view, the editors in data-app.
	for (const button of $('rail').querySelectorAll('[data-app], [data-teams], [data-notebook]'))
		button.hidden = (button.dataset.app || button.dataset.view) !== product;
	$('app-launcher').innerHTML =
		`<div class="launcher-heading"><h2>Your apps</h2></div><div class="launcher-grid"><a href="${new URL('?suite', suiteBase)}">OOXML Office</a>${suiteApps.map((a) => `<a href="${new URL(`apps/${productPaths[a.id]}/`, suiteBase)}">${badge(a.id)}<span>${a.name}</span></a>`).join('')}</div>`;
}
