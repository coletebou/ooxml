// Which Office product opens a file, from its name or MIME type. Format-neutral: the team
// workspace uses it to open attachments and the notebook to show embedded files live. Moved from
// `teams/model.ts`. Pure, no DOM.

/** The Office products a host can open a file in; `other` is everything else. */
export type OfficeKind = 'docx' | 'xlsx' | 'pptx' | 'vsdx' | 'other';

const OFFICE_EXTENSIONS: Record<string, OfficeKind> = {
	docx: 'docx',
	docm: 'docx',
	dotx: 'docx',
	xlsx: 'xlsx',
	xlsm: 'xlsx',
	xltx: 'xlsx',
	pptx: 'pptx',
	pptm: 'pptx',
	potx: 'pptx',
	ppsx: 'pptx',
	vsdx: 'vsdx',
	vsdm: 'vsdx',
	vssx: 'vsdx',
	vstx: 'vsdx',
};

/** Which Office viewer opens a file, from its name (the extension wins over the MIME type). */
export function detectOfficeKind(name: string, mime?: string): OfficeKind {
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	const byExt = OFFICE_EXTENSIONS[ext];
	if (byExt) return byExt;
	const m = mime?.toLowerCase() ?? '';
	if (m.includes('wordprocessingml')) return 'docx';
	if (m.includes('spreadsheetml')) return 'xlsx';
	if (m.includes('presentationml')) return 'pptx';
	if (m.includes('visio')) return 'vsdx';
	return 'other';
}
