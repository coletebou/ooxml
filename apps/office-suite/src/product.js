import { $, appOf, badge, suiteApps } from './ui.js';
export const product = document.body.dataset.product || '';
/** The suite lists every kind of file, and so do Teams and Mail, whose attachments are any kind. */
export const listsEveryKind = !product || product === 'teams' || product === 'mail';
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
	mail: 'mail',
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
		links.innerHTML = `<summary>Open apps separately</summary>${Object.entries(productPaths)
			.map(([id, path]) => `<a href="${new URL(`apps/${path}/`, suiteBase)}">${appOf(id).name}</a>`)
			.join('')}`;
		$('app-launcher').append(links);
		return;
	}
	const app = appOf(product);
	const brand = document.querySelector('.brand');
	brand.innerHTML = `${badge(product)}<strong>${app.name}</strong>`;
	brand.setAttribute('aria-label', `${app.name} home`);
	for (const button of $('rail').querySelectorAll('[data-app], [data-teams], [data-mail]'))
		button.hidden =
			(button.dataset.app || ('mail' in button.dataset ? 'mail' : 'teams')) !== product;
	$('app-launcher').innerHTML =
		`<div class="launcher-heading"><h2>Your apps</h2></div><div class="launcher-grid"><a href="${new URL('?suite', suiteBase)}">OOXML Office</a>${suiteApps.map((a) => `<a href="${new URL(`apps/${productPaths[a.id]}/`, suiteBase)}">${badge(a.id)}<span>${a.name}</span></a>`).join('')}</div>`;
}
