import { cleanFileName, emlFileName, extensionFor, safeFileName } from './file-names';

const RLO = String.fromCharCode(0x202e);

describe('cleanFileName', () => {
	it('drops directories, and control and bidirectional formatting characters', () => {
		expect(cleanFileName('C:\\fakepath\\report.pdf')).toBe('report.pdf');
		expect(cleanFileName('../../etc/passwd')).toBe('passwd');
		expect(cleanFileName(`invoice${RLO}fdp.exe`)).toBe('invoicefdp.exe');
		expect(cleanFileName('a\u0000b\tc.txt')).toBe('a b c.txt');
		expect(cleanFileName('Résumé.pdf')).toBe('Résumé.pdf');
	});

	it('gives null when nothing is left', () => {
		expect(cleanFileName('   ')).toBeNull();
		expect(cleanFileName('folder/')).toBeNull();
		expect(cleanFileName(undefined)).toBeNull();
	});
});

describe('safeFileName and emlFileName', () => {
	it('make a subject a file name every desktop system accepts', () => {
		expect(emlFileName('Re: Q3 plan / budget?')).toBe('Re Q3 plan budget.eml');
		expect(emlFileName('  ...hidden.  ')).toBe('hidden.eml');
		expect(emlFileName('a<b>c|d*e"f')).toBe('a b c d e f.eml');
		expect(emlFileName('CON')).toBe('_CON.eml');
		expect(emlFileName('lpt1.txt')).toBe('_lpt1.txt.eml');
		expect(emlFileName(`tab\there${RLO}`)).toBe('tab here.eml');
	});

	it('fall back when nothing is left', () => {
		expect(emlFileName('')).toBe('message.eml');
		expect(emlFileName('***')).toBe('message.eml');
		expect(safeFileName('...', 'fallback')).toBe('fallback');
	});

	it('cut long names to 80 characters without splitting a character', () => {
		expect(emlFileName('x'.repeat(200))).toBe(`${'x'.repeat(76)}.eml`);
		expect(emlFileName('😀'.repeat(100))).toBe(`${'😀'.repeat(76)}.eml`);
		expect(emlFileName(`${'y'.repeat(75)} .tail`)).toBe(`${'y'.repeat(75)}.eml`);
	});
});

describe('extensionFor', () => {
	it('knows the common types and falls back to bin', () => {
		expect(extensionFor('image/jpeg')).toBe('jpg');
		expect(extensionFor('message/rfc822')).toBe('eml');
		expect(extensionFor('application/x-unknown')).toBe('bin');
		expect(extensionFor('constructor')).toBe('bin');
	});
});
