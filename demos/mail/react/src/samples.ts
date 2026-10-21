// Real Office files for the demo mailbox's attachments: the workbook and the deck of the xlsx and
// pptx demos (bundled from there as assets, not copied), a letter and a blank drawing written by
// ooxml-core itself, so the attachment previews open genuine documents.
import type { DemoSeedOptions } from 'ooxml-core/mail';
import workbookUrl from '../../../xlsx/demo-vanilla/public/sample.xlsx?url';
import deckUrl from '../../../pptx/demo-react/public/sample-deck.pptx?url';

async function fetched(path: string): Promise<Uint8Array | undefined> {
	try {
		const response = await fetch(new URL(path, document.baseURI));
		return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
	} catch {
		return undefined;
	}
}

async function letter(): Promise<Uint8Array | undefined> {
	const { createDocument, saveDocx } = await import('ooxml-core/docx');
	const lines = [
		'Your trip to Lisbon',
		'Flight on the 12th, departing 08:40.',
		'Hotel near the river for three nights, breakfast included.',
		'Have a good trip!',
	];
	const model = createDocument();
	return saveDocx({
		...model,
		blocks: lines.map((text, index) => ({
			type: 'paragraph',
			id: `p${index + 1}`,
			runs: [{ text }],
		})),
	});
}

async function drawing(): Promise<Uint8Array | undefined> {
	const { createVsdx } = await import('ooxml-core/visio');
	return createVsdx({ width: 11, height: 8.5 });
}

/** The files the demo seed attaches, each optional: a failed one is simply left out. */
export async function demoFiles(): Promise<NonNullable<DemoSeedOptions['files']>> {
	const [xlsx, pptx, docx, vsdx] = await Promise.all([
		fetched(workbookUrl),
		fetched(deckUrl),
		letter().catch(() => undefined),
		drawing().catch(() => undefined),
	]);
	return {
		...(xlsx ? { xlsx } : {}),
		...(pptx ? { pptx } : {}),
		...(docx ? { docx } : {}),
		...(vsdx ? { vsdx } : {}),
	};
}
