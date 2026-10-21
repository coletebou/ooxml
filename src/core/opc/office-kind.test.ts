import { describe, expect, it } from 'vitest';
import { detectOfficeKind } from './office-kind';

describe('detectOfficeKind', () => {
	it('detects Office kinds from the extension before the MIME type', () => {
		expect(detectOfficeKind('Budget.XLSX')).toBe('xlsx');
		expect(detectOfficeKind('plan.vsdx')).toBe('vsdx');
		expect(
			detectOfficeKind(
				'x',
				'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			),
		).toBe('pptx');
		expect(detectOfficeKind('notes.txt')).toBe('other');
	});
});
