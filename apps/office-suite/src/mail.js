/**
 * Mail, calendar and contacts: `<mail-app>` from ooxml-ui/mail on its in-memory demo mailbox (the
 * suite connects to no mail server, and GitHub Pages is static). The demo carries an Office file on
 * four of its messages when the host supplies them, so the suite writes those with the core. An
 * Office attachment opens in the suite's own editor as a library copy; any other file keeps the
 * app's built-in preview.
 */
import { blankDocument } from './editors.js';
import { onTheme } from './themes.js';
import { applyOfficeTheme } from './theme-tokens.js';
import { task } from './ui.js';

/** What the library holds, up to the size it accepts from this device (main.js importFiles). */
const OFFICE = /\.(docx|xlsx|pptx|vsdx)$/iu;
const LIMIT = 32 * 1024 * 1024;

/** The demo's attachments, each optional: one that fails to write is left out of the mailbox. */
async function demoFiles() {
	const automation = () => import('ooxml-core/automation');
	const writers = {
		// The letter and the invoice match their messages, so an opened copy shows its own content.
		docx: async () =>
			(await automation()).createDocx([
				'Your trip to Lisbon',
				'Flight on the 12th, departing 08:40.',
				'Hotel near the river for three nights, breakfast included.',
			]),
		xlsx: async () => {
			const { createXlsx, setXlsxCells } = await automation();
			const rows = [
				['Item', 'Amount'],
				['Consulting, September', '1200'],
				['Travel', '340'],
				['Total', '=SUM(B2:B3)'],
			];
			const cells = rows.flatMap((row, r) =>
				row.map((input, c) => ({ address: `${'AB'[c]}${r + 1}`, input })),
			);
			return (await setXlsxCells(await createXlsx(['Invoice']), 0, cells)).bytes;
		},
		pptx: () => blankDocument('pptx'),
		vsdx: () => blankDocument('vsdx'),
	};
	const files = await Promise.all(
		Object.entries(writers).map(async ([kind, write]) => [kind, await write().catch(() => null)]),
	);
	return Object.fromEntries(files.filter(([, bytes]) => bytes));
}

let loading;
/** The element, the calendar zone and the demo files, loaded once; hovering Mail starts it early. */
export function preloadMail() {
	loading ??= Promise.all([
		import('ooxml-ui/mail'),
		import('ooxml-core/calendar'),
		demoFiles(),
	]).catch((error) => {
		loading = undefined;
		throw error;
	});
	return loading;
}

export async function mountMail(host, store, open, refresh) {
	const [{ registerMail }, { localZone }, files] = await preloadMail();
	registerMail();
	const mail = document.createElement('mail-app');
	// The page language, as Teams takes it (teams.js); English when Mail does not ship that one.
	mail.locale = document.documentElement.lang || '';
	// Set before the element connects, so its client starts once, on this mailbox. The events sit
	// in the zone the calendar shows.
	mail.config = { kind: 'demo', seed: { files, zone: localZone() } };
	mail.addEventListener('mail-open-attachment', (event) => {
		const { emailId, attachment, bytes } = event.detail;
		if (!OFFICE.test(attachment.name) || bytes.length > LIMIT) return;
		event.preventDefault();
		task(async () => {
			// One library copy per attachment, as for a Teams attachment: opening it again reopens
			// that copy with its edits instead of importing another.
			const sourceUrl = `mail:${emailId}/${attachment.blobId}`;
			const doc =
				(await store.list()).find((d) => d.sourceUrl === sourceUrl) ??
				(await store.create(attachment.name, bytes, { sourceUrl }));
			await refresh();
			await open(doc.id, undefined, { focus: true });
		});
	});
	onTheme(({ mode, accent }) => {
		mail.theme = mode;
		applyOfficeTheme(mail, { mode, accent });
	});
	host.append(mail);
	return mail;
}
