// A small Word document built in the test (a heading and a paragraph), so no binary fixture is
// committed. Only the parts a reader needs: content types, the package and document relationships,
// the document and a style sheet with Normal and Heading 1.
import JSZip from 'jszip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006';

const escape = (text: string): string =>
	text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function wordFile(heading: string, text: string): Promise<Buffer> {
	const zip = new JSZip();
	zip.file(
		'[Content_Types].xml',
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${PKG}/content-types">` +
			'<Default Extension="xml" ContentType="application/xml"/>' +
			'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
			`<Override PartName="/word/document.xml" ContentType="${WORD_MIME}.main+xml"/>` +
			'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
			'</Types>',
	);
	zip.file(
		'_rels/.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}/relationships">` +
			`<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
			'</Relationships>',
	);
	zip.file(
		'word/_rels/document.xml.rels',
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}/relationships">` +
			`<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>` +
			'</Relationships>',
	);
	zip.file(
		'word/styles.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}">` +
			'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
			'<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
			'<w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
			'</w:styles>',
	);
	zip.file(
		'word/document.xml',
		`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>` +
			`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escape(heading)}</w:t></w:r></w:p>` +
			`<w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p>` +
			'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
			'<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
			'</w:sectPr></w:body></w:document>',
	);
	return zip.generateAsync({ type: 'nodebuffer' });
}
