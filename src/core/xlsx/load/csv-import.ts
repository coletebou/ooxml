// Typing of CSV fields with the controls Excel offers for text imports: its automatic data
// conversion switches (File > Options > Data) and the Text Import Wizard's column data formats,
// decimal and thousands separators and trailing minus. Conversions that change what the file
// says are tallied per column and reported as workbook warnings.
import { columnLabel, MAX_COL } from '../address';
import { isDateFormat, parseCellInput, type ParsedInput } from '../numfmt/index';
import { parseOrderedDate, type CsvDateOrder } from './csv-dates';
import { separatorNormalizer, separatorsOf } from './csv-separators';
import { dateTraits, keepsDigits, LONG_NUMBER, numberTraits, TIME_ZONE } from './csv-traits';

/**
 * Excel's automatic data conversions. Each is on by default, as in Excel and as typing into a
 * cell; turning one off keeps the fields it would convert as text.
 */
export interface CsvConversions {
	/** "Remove leading zeros and convert to number": `00123` becomes 123. */
	leadingZeros?: boolean;
	/**
	 * "Keep the first 15 digits of long numbers": fields of 16 or more significant digits (counted
	 * from the first non-zero digit) become numbers. Turned off, they all stay text, as in Excel;
	 * left on, only those whose number does not keep every digit are reported.
	 */
	longNumbers?: boolean;
	/** "Convert digits surrounding the letter E": `123E5` becomes 12300000. */
	scientific?: boolean;
	/** "Convert date-like combinations of continuous letters and numbers": `JAN1` becomes a date. */
	letterDates?: boolean;
}

/**
 * A column's data format, as in step 3 of the Text Import Wizard. `'general'` types fields like
 * typing into a cell (subject to the conversions); `'text'` keeps them verbatim, formulas included,
 * with the Text number format; `'skip'` does not import the column, so the following columns move
 * left; a date order reads day, month and year in that order (see {@link CsvDateOrder}) and falls
 * back to General for a field that is not such a date.
 */
export type CsvColumnFormat = 'general' | 'text' | 'skip' | CsvDateOrder;

export interface CsvImportOptions {
	/** The automatic data conversions applied to General columns; all on by default. */
	conversions?: CsvConversions;
	/**
	 * Data formats by zero-based source column (`{ 0: 'text', 3: 'DMY' }`, or an array); columns
	 * not listed are `'general'`.
	 */
	columns?: Readonly<Record<number, CsvColumnFormat>>;
	/** The decimal separator of numbers in General columns (default `.`). */
	decimalSeparator?: string;
	/** The thousands separator (default `,`, or `.` when the decimal separator is `,`). */
	thousandsSeparator?: string;
	/** Read a trailing minus (`123-`) as a negative number. Off by default. */
	trailingMinus?: boolean;
	/**
	 * Add one workbook warning per column and kind of conversion that changed data (leading zeros
	 * dropped, digits a number could not keep, letters to dates, time zones made UTC) or may have
	 * (digits around `E`, since `123E5` the identifier and `1.5E5` the number look alike), with a
	 * count and the first cell. On by default.
	 */
	reportConversions?: boolean;
}

/** Conversion kinds in report order; the index is the kind's bit in a traits mask. */
const KINDS = [
	{
		conversion: 'leadingZeros',
		one: 'value lost its leading zeros when converted to a number',
		many: 'values lost their leading zeros when converted to numbers',
	},
	{
		conversion: 'longNumbers',
		one: 'value with more than 15 digits lost digits when converted to a number',
		many: 'values with more than 15 digits lost digits when converted to numbers',
	},
	{
		conversion: 'scientific',
		one: 'value with the letter E was converted to a number in scientific notation',
		many: 'values with the letter E were converted to numbers in scientific notation',
	},
	{
		conversion: 'letterDates',
		one: 'value of letters and digits such as JAN1 was converted to a date',
		many: 'values of letters and digits such as JAN1 were converted to dates',
	},
	{
		conversion: undefined,
		one: 'date-time with a time zone was converted to UTC',
		many: 'date-times with a time zone were converted to UTC',
	},
] as const;
const FORMATS = new Set(['general', 'text', 'skip', 'MDY', 'DMY', 'YMD', 'MYD', 'DYM', 'YDM']);

/** The formats typing gives a mixed fraction (`1 1/2`), whose space is not a thousands separator. */
const FRACTION_FORMATS = new Set(['# ?/?', '# ??/??']);

/** The separators the default typing reads, so a number they produced is not localized. */
const EN_US_SEPARATORS_RE = /[.,]/;

/** A sign or parenthesis before the digits (after any currency symbol): no trailing minus then. */
const SIGNED_RE = /^\s*(?:[$€£]\s*)?[-+(]/;

function columnFormats(columns: CsvImportOptions['columns']): (CsvColumnFormat | undefined)[] {
	const formats: (CsvColumnFormat | undefined)[] = [];
	for (const [key, format] of Object.entries(columns ?? {})) {
		const col = Number(key);
		if (!Number.isInteger(col) || col < 0 || col > MAX_COL)
			throw new RangeError(`CSV column ${key} is not a zero-based column index.`);
		if (!FORMATS.has(format))
			throw new RangeError(`Unknown CSV column format "${String(format)}" for column ${col}.`);
		formats[col] = format;
	}
	return formats;
}

export interface CsvFieldReader {
	/** Where source column `col` lands once skipped columns are removed; -1 when it is skipped. */
	target(col: number): number;
	/** The typed value of a non-empty field in source column `col`. */
	read(field: string, row: number, col: number): ParsedInput;
	/** One warning per column and kind of conversion that changed data. */
	warnings(): string[];
}

/** A field reader for one import; throws `RangeError` for invalid options. */
export function createFieldReader(
	options: CsvImportOptions & { formulas?: boolean },
	date1904: boolean,
): CsvFieldReader {
	const formats = columnFormats(options.columns);
	const targets: number[] = [];
	let skipped = 0;
	for (let col = 0; col < formats.length; col++) {
		if (formats[col] === 'skip') {
			targets.push(-1);
			skipped++;
		} else targets.push(col - skipped);
	}
	const target = (col: number): number =>
		col < targets.length ? (targets[col] ?? -1) : col - skipped;

	let keepText = 0;
	KINDS.forEach(({ conversion }, kind) => {
		if (conversion && options.conversions?.[conversion] === false) keepText |= 1 << kind;
	});
	const separators = separatorsOf(options.decimalSeparator, options.thousandsSeparator);
	const normalize = separatorNormalizer(separators);
	const decimal = separators.decimal.charCodeAt(0);
	const thousands = separators.thousands.charCodeAt(0);
	const { formulas = false, trailingMinus = false } = options;
	// Per column and kind (`col * KINDS.length + kind`): how many fields, and the first one's row.
	const counts: number[] = [];
	const firstRows: number[] = [];
	const report = (traits: number, row: number, col: number): void => {
		if (options.reportConversions === false) return;
		for (let kind = 0; kind < KINDS.length; kind++) {
			if (!(traits & (1 << kind))) continue;
			const key = col * KINDS.length + kind;
			const count = counts[key];
			if (count === undefined) firstRows[key] = row;
			counts[key] = (count ?? 0) + 1;
		}
	};

	const dateFormats = new Map<string, boolean>();
	const isDate = (numFmt: string | undefined): boolean => {
		if (numFmt === undefined) return false;
		let known = dateFormats.get(numFmt);
		if (known === undefined) {
			known = isDateFormat(numFmt);
			dateFormats.set(numFmt, known);
		}
		return known;
	};
	const isNumber = (parsed: ParsedInput): parsed is ParsedInput & { value: number } =>
		typeof parsed.value === 'number' && parsed.formula === undefined && !isDate(parsed.numFmt);

	/**
	 * Typing with the configured separators: a number only the default `.` and `,` make (`3.14`
	 * with a comma decimal) reads as text; one that needs no separator (`1 1/2`) stays a number.
	 */
	const localized = (text: string, normalized: string): ParsedInput => {
		const parsed = parseCellInput(normalized);
		if (normalized === text || isNumber(parsed)) return parsed;
		const plain = parseCellInput(text);
		return isNumber(plain) && EN_US_SEPARATORS_RE.test(text) ? { value: text } : plain;
	};
	const type = normalize
		? (text: string): ParsedInput => localized(text, normalize(text))
		: (text: string): ParsedInput => parseCellInput(text);

	const negative = (field: string): ParsedInput | undefined => {
		const text = field.trimEnd();
		if (text.length < 2 || !text.endsWith('-')) return undefined;
		const body = text.slice(0, -1);
		if (SIGNED_RE.test(body)) return undefined;
		const parsed = type(body);
		if (!isNumber(parsed)) return undefined;
		return { ...parsed, value: parsed.value === 0 ? 0 : -parsed.value };
	};

	const general = (field: string, row: number, col: number): ParsedInput => {
		if (!formulas && field.startsWith('=')) return { value: field };
		const parsed = (trailingMinus ? negative(field) : undefined) ?? type(field);
		if (typeof parsed.value !== 'number' || parsed.formula !== undefined) return parsed;
		// No thousands separator inside a mixed fraction (-1 matches no character).
		const grouping = FRACTION_FORMATS.has(parsed.numFmt ?? '') ? -1 : thousands;
		const traits = isDate(parsed.numFmt)
			? dateTraits(field)
			: numberTraits(field, decimal, grouping);
		if (traits === 0) return parsed;
		if (traits & keepText) return { value: field };
		// Excel's rule decides what the switch keeps; a warning says only what was really lost.
		const kept = traits & LONG_NUMBER && keepsDigits(field, parsed.value);
		const lost = kept ? traits ^ LONG_NUMBER : traits;
		if (lost) report(lost, row, col);
		return parsed;
	};

	return {
		target,
		read(field, row, col) {
			const format = col < formats.length ? formats[col] : undefined;
			if (format === undefined || format === 'general') return general(field, row, col);
			if (format === 'text') return { value: field, numFmt: '@' };
			if (format === 'skip') return { value: null };
			const date = parseOrderedDate(field.trim(), format, date1904);
			if (!date) return general(field, row, col);
			if (date.zoned) report(TIME_ZONE, row, col);
			return { value: date.value, numFmt: date.numFmt };
		},
		warnings() {
			const warnings: string[] = [];
			counts.forEach((count, key) => {
				const kind = KINDS[key % KINDS.length];
				const label = columnLabel(target(Math.floor(key / KINDS.length)));
				const what = count === 1 ? kind?.one : kind?.many;
				const row = (firstRows[key] ?? 0) + 1;
				warnings.push(`Column ${label}: ${count} ${what} (first: ${label}${row}).`);
			});
			return warnings;
		},
	};
}
