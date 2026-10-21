// Real Office files for the demo mailbox's attachments: a workbook and a deck from the public
// folder (copies of the xlsx and pptx demos' samples), a letter and a blank drawing written by
// ooxml-core itself, so the attachment previews open genuine documents.
import type { DemoSeedOptions } from 'ooxml-core/mail';

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
		fetched('samples/invoice.xlsx'),
		fetched('samples/roadmap.pptx'),
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
