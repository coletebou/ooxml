import { describe, expect, it } from 'vitest';
import { parseAddress, parseRange, type CellRange } from '../address';
import { putCell } from '../cells';
import { cellError, type Cell, type Workbook } from '../model';
import { internStyle, patchStyle } from '../styles';
import { createWorkbook, defaultCellStyle } from '../workbook';
import { compareWorkbooks } from './compare';
import { comparisonText } from './text';

const R = (ref: string): CellRange => {
	const range = parseRange(ref);
	if (!range) throw new Error(ref);
	return range;
};

function put(workbook: Workbook, ref: string, cell: Partial<Cell>, sheet = 0): void {
	const at = parseAddress(ref);
	if (!at) throw new Error(ref);
	putCell(workbook.sheets[sheet]!, at.row, at.col, { value: null, ...cell });
}

function pair(): [Workbook, Workbook] {
	const before = createWorkbook({ sheets: ['Data', 'Old', 'Notes'] });
	const after = createWorkbook({ sheets: ['Inputs', 'Notes', 'Extra'] });
	after.sheets[0]!.sheetId = 1;
	after.sheets[1]!.sheetId = 3;
	after.sheets[1]!.state = 'hidden';
	after.sheets[2]!.sheetId = 4;
	before.definedNames = [{ name: 'Rate', formula: 'Data!$A$1' }];
	after.definedNames = [
		{ name: 'Rate', formula: 'Inputs!$A$2' },
		{ name: 'Local', formula: '1', localSheet: 1, hidden: true },
	];
	after.sheets[0]!.merges = [R('D1:E1')];
	put(before, 'A1', { value: 1 });
	put(after, 'A1', { value: 'one' });
	put(before, 'B1', { value: 2, formula: 'A1*2' });
	put(after, 'B1', { value: cellError('#VALUE!'), formula: 'A1*3' });
	put(before, 'C1', { value: 3, formula: 'A1+2' });
	put(after, 'C1', { value: 4, formula: 'A1+2' });
	const percent = internStyle(after, patchStyle(defaultCellStyle(), { numFmt: '0%' }));
	put(before, 'A2', { value: 0.5 });
	put(after, 'A2', { value: 0.5, styleId: percent });
	for (const ref of ['A4', 'B4', 'A5', 'B5']) put(after, ref, { value: true });
	return [before, after];
}

describe('comparisonText', () => {
	it('lists workbook, structure and cell differences in order, grouping neighbouring cells', () => {
		const [before, after] = pair();
		expect(comparisonText(compareWorkbooks(before, after))).toBe(
			[
				'Workbook',
				'  Sheet "Old" removed from position 2',
				'  Sheet "Extra" added at position 3',
				'  Sheet "Data" renamed to "Inputs"',
				'  Sheet "Notes" visible -> hidden',
				'  Name Local ("Notes") added: =1 (hidden)',
				'  Name Rate changed: =Data!$A$1 -> =Inputs!$A$2',
				'Sheet "Inputs" (was "Data")',
				'  Merge added D1:E1',
				'  A1 entered value: 1 -> "one"',
				'  B1 formula: =A1*2 -> =A1*3',
				'  C1 calculated value: 3 -> 4 (=A1+2)',
				'  A2 format (number format): "General" -> "0%"',
				'  A4:B5 entered value: 4 cells',
				'Not compared: rowAndColumnLayout, rowAndColumnFormats, comments, hyperlinks, drawings, pivotTables, conditionalFormatExtensions, sparklines, slicers, autoFilter, sheetViews, pageSetup, sheetProtection, documentProperties, theme, workbookSettings, macrosAndUnmodelledParts.',
				'',
			].join('\n'),
		);
	});

	it('prints one line per cell on request', () => {
		const [before, after] = pair();
		const text = comparisonText(compareWorkbooks(before, after, { categories: ['enteredValue'] }), {
			cells: true,
		});
		expect(text.split('\n').slice(0, 7)).toEqual([
			'Sheet "Inputs" (was "Data")',
			'  A1 entered value: 1 -> "one"',
			'  A4 entered value: (empty) -> TRUE',
			'  B4 entered value: (empty) -> TRUE',
			'  A5 entered value: (empty) -> TRUE',
			'  B5 entered value: (empty) -> TRUE',
			'Not compared: formula, calculatedValue, format, sheet, name, merge, table, dataValidation, conditionalFormat, rowAndColumnLayout, rowAndColumnFormats, comments, hyperlinks, drawings, pivotTables, conditionalFormatExtensions, sparklines, slicers, autoFilter, sheetViews, pageSetup, sheetProtection, documentProperties, theme, workbookSettings, macrosAndUnmodelledParts.',
		]);
	});

	it('says when there is nothing to report and when the report stopped early', () => {
		const book = createWorkbook();
		expect(comparisonText(compareWorkbooks(book, structuredClone(book)))).toMatch(
			/^No differences\.\nNot compared: rowAndColumnLayout, /,
		);
		const [before, after] = pair();
		const lines = comparisonText(compareWorkbooks(before, after, { maxDifferences: 2 })).split(
			'\n',
		);
		expect(lines.slice(0, 4)).toEqual([
			'Workbook',
			'  Sheet "Old" removed from position 2',
			'  Sheet "Extra" added at position 3',
			'Stopped after 2 differences; there may be more.',
		]);
	});
});
