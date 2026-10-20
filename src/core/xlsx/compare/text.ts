// A plain-text report of a workbook comparison, for a terminal or a code review: one line per
// difference, in the result's stable order, with A1 addresses and old -> new values.
import { formatAddress, formatRange, type CellRange } from '../address';
import { isCellError, type CellValue, type ConditionalFormat, type DefinedName } from '../model';
import type {
	CellDifference,
	CellDifferenceRange,
	CellSide,
	FormatAttribute,
	SheetDifference,
	WorkbookComparison,
	WorkbookDifference,
} from './types';

export interface ComparisonTextOptions {
	/** One line per cell instead of one per range of neighbouring cells; default false. */
	cells?: boolean;
}

const KIND_TEXT: Record<CellDifference['kind'], string> = {
	enteredValue: 'entered value',
	formula: 'formula',
	calculatedValue: 'calculated value',
	format: 'format',
};

const ATTRIBUTE_TEXT: Record<FormatAttribute, string> = {
	numberFormat: 'number format',
	font: 'font',
	fill: 'fill',
	border: 'border',
	alignment: 'alignment',
	protection: 'protection',
	richText: 'rich text',
};

const quote = (text: string) => JSON.stringify(text);

/** A value as a report shows it: strings quoted, so `"1"` and `1` differ visibly. */
function valueText(value: CellValue): string {
	if (value === null) return '(empty)';
	if (typeof value === 'string') return quote(value);
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
	if (isCellError(value)) return value.error;
	return String(value);
}

/** A formula (with its array range) when the cell has one, else its value. */
function cellText(side: CellSide): string {
	if (side.formula === undefined) return valueText(side.value);
	const array = side.arrayRange ? ` (array ${formatRange(side.arrayRange)})` : '';
	return `=${side.formula}${array}`;
}

const position = (index: number) => `position ${index + 1}`;
const nameText = (d: { name: string; scope?: string }) =>
	d.scope === undefined ? d.name : `${d.name} (${quote(d.scope)})`;
const definition = (name: DefinedName) => `=${name.formula}${name.hidden ? ' (hidden)' : ''}`;

function workbookLine(d: WorkbookDifference): string {
	switch (d.kind) {
		case 'sheetAdded':
			return `Sheet ${quote(d.sheet)} added at ${position(d.index)}`;
		case 'sheetRemoved':
			return `Sheet ${quote(d.sheet)} removed from ${position(d.index)}`;
		case 'sheetRenamed':
			return `Sheet ${quote(d.from)} renamed to ${quote(d.to)}`;
		case 'sheetMoved':
			return `Sheet ${quote(d.sheet)} moved from ${position(d.from)} to ${position(d.to)}`;
		case 'sheetState':
			return `Sheet ${quote(d.sheet)} ${d.from} -> ${d.to}`;
		case 'nameAdded':
			return `Name ${nameText(d)} added: ${definition(d.after)}`;
		case 'nameRemoved':
			return `Name ${nameText(d)} removed: ${definition(d.before)}`;
		case 'nameChanged':
			return `Name ${nameText(d)} changed: ${definition(d.before)} -> ${definition(d.after)}`;
	}
}

const rangesText = (list: readonly CellRange[]) => list.map(formatRange).join(' ');
const ruleText = (format: ConditionalFormat) =>
	`${rangesText(format.ranges)} (${format.rules.map((rule) => rule.type).join(', ')})`;

function sheetLine(d: SheetDifference): string {
	switch (d.kind) {
		case 'mergeAdded':
			return `Merge added ${formatRange(d.range)}`;
		case 'mergeRemoved':
			return `Merge removed ${formatRange(d.range)}`;
		case 'tableAdded':
			return `Table ${d.table} added at ${formatRange(d.after.range)}`;
		case 'tableRemoved':
			return `Table ${d.table} removed from ${formatRange(d.before.range)}`;
		case 'tableChanged': {
			const where =
				formatRange(d.before.range) === formatRange(d.after.range)
					? formatRange(d.after.range)
					: `${formatRange(d.before.range)} -> ${formatRange(d.after.range)}`;
			return `Table ${d.table} changed (${d.fields.join(', ')}): ${where}`;
		}
		case 'dataValidationAdded':
			return `Data validation added ${rangesText(d.after.ranges)} (${d.after.type})`;
		case 'dataValidationRemoved':
			return `Data validation removed ${rangesText(d.before.ranges)} (${d.before.type})`;
		case 'conditionalFormatAdded':
			return `Conditional format rule added ${ruleText(d.after)}`;
		case 'conditionalFormatRemoved':
			return `Conditional format rule removed ${ruleText(d.before)}`;
		case 'conditionalFormatReordered':
			return `Conditional format rule reordered ${ruleText(d.after)}`;
	}
}

function attributesText(attributes: readonly FormatAttribute[] | undefined): string {
	return (attributes ?? []).map((a) => ATTRIBUTE_TEXT[a]).join(', ');
}

function cellLine(d: CellDifference): string {
	const at = `${formatAddress(d.address)} ${KIND_TEXT[d.kind]}`;
	if (d.kind === 'formula') return `${at}: ${cellText(d.before)} -> ${cellText(d.after)}`;
	if (d.kind !== 'format') {
		const formula = d.after.formula === undefined ? '' : ` (=${d.after.formula})`;
		return `${at}: ${valueText(d.before.value)} -> ${valueText(d.after.value)}${formula}`;
	}
	const line = `${at} (${attributesText(d.attributes)})`;
	const from = d.before.style?.numFmt;
	const to = d.after.style?.numFmt;
	return d.attributes?.includes('numberFormat') && from !== undefined && to !== undefined
		? `${line}: ${quote(from)} -> ${quote(to)}`
		: line;
}

function rangeLine(range: CellDifferenceRange, first: CellDifference | undefined): string {
	if (range.count === 1 && first) return cellLine(first);
	const attributes = range.attributes ? ` (${attributesText(range.attributes)})` : '';
	return `${formatRange(range.range)} ${KIND_TEXT[range.kind]}${attributes}: ${range.count} cells`;
}

/** The comparison as text: workbook changes, then each sheet with differences, then the limits. */
export function comparisonText(
	result: WorkbookComparison,
	options: ComparisonTextOptions = {},
): string {
	const lines: string[] = [];
	if (result.workbook.length) {
		lines.push('Workbook');
		for (const d of result.workbook) lines.push(`  ${workbookLine(d)}`);
	}
	for (const sheet of result.sheets) {
		if (!sheet.structure.length && !sheet.cells.length) continue;
		const renamed = sheet.beforeName === sheet.name ? '' : ` (was ${quote(sheet.beforeName)})`;
		lines.push(`Sheet ${quote(sheet.name)}${renamed}`);
		for (const d of sheet.structure) lines.push(`  ${sheetLine(d)}`);
		if (options.cells) {
			for (const d of sheet.cells) lines.push(`  ${cellLine(d)}`);
		} else {
			const firstAt = new Map<string, CellDifference>();
			for (const d of sheet.cells) firstAt.set(`${d.kind}\n${formatAddress(d.address)}`, d);
			for (const range of sheet.ranges) {
				const first = firstAt.get(`${range.kind}\n${formatAddress(range.range.start)}`);
				lines.push(`  ${rangeLine(range, first)}`);
			}
		}
	}
	if (!lines.length) lines.push('No differences.');
	if (result.truncated) lines.push(`Stopped after ${result.count} differences; there may be more.`);
	lines.push(`Not compared: ${result.notCompared.join(', ')}.`);
	return `${lines.join('\n')}\n`;
}
