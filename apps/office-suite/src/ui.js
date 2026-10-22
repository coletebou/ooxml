/** The apps, with the maturity each one declares on its own site. */
export const apps = [
	{ id: 'docx', name: 'Word', letter: 'W', color: '#185abd', tag: 'Beta' },
	{ id: 'xlsx', name: 'Excel', letter: 'X', color: '#107c41', tag: 'Beta' },
	{ id: 'pptx', name: 'PowerPoint', letter: 'P', color: '#c43e1c' },
	{ id: 'vsdx', name: 'Visio', letter: 'V', color: '#3955a3', tag: 'Alpha' },
];
export const teamsApp = { id: 'teams', name: 'Teams', letter: 'T', color: '#6264a7', tag: 'Alpha' };
export const mailApp = { id: 'mail', name: 'Mail', letter: 'M', color: '#1f6feb', tag: 'Alpha' };
/** Every app of the suite: the document apps, then Teams and Mail. */
export const suiteApps = [...apps, teamsApp, mailApp];
/** The app with `id`; Teams for an id the suite does not know. */
export const appOf = (id) => suiteApps.find((a) => a.id === id) ?? teamsApp;
/** A maturity tag, or nothing for an app without one. */
export const tag = (label) =>
	label ? `<i class="app-tag" data-tone="${label.toLowerCase()}">${label}</i>` : '';
export const $ = (id) => document.getElementById(id);
export const escape = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const badge = (kind) => {
	const a = appOf(kind);
	return `<span class="app-badge" style="--app:${a.color}">${a.letter}</span>`;
};
export function notify(message) {
	$('status').textContent = message instanceof Error ? message.message : message;
}
export function task(fn) {
	return Promise.resolve().then(fn).catch(notify);
}
export function download(doc) {
	const url = URL.createObjectURL(new Blob([doc.bytes]));
	const a = document.createElement('a');
	a.href = url;
	a.download = doc.name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function choose(title, content) {
	const dialog = $('dialog');
	$('dialog-title').textContent = title;
	$('dialog-content').replaceChildren(content);
	dialog.showModal();
	return dialog;
}
