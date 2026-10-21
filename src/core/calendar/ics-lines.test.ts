import { parseContentLine, readComponents, unescapeText, unfoldLines } from './ics-lines';

describe('content lines', () => {
	it('unfolds lines continued by a space or a tab after CRLF, LF or CR', () => {
		expect(unfoldLines('A:one\r\n two\r\n\tthree\nB:x\n y\rC:z')).toEqual([
			'A:onetwothree',
			'B:xy',
			'C:z',
		]);
		expect(unfoldLines('\uFEFFBEGIN:VCALENDAR')).toEqual(['BEGIN:VCALENDAR']);
		// A continuation keeps the characters after its first space.
		expect(unfoldLines('DESCRIPTION:a\r\n  b')).toEqual(['DESCRIPTION:a b']);
	});

	it('splits the name, the parameters and the value', () => {
		expect(parseContentLine('dtstart;tzid=Europe/Berlin:20261015T090000')).toEqual({
			name: 'DTSTART',
			params: { TZID: ['Europe/Berlin'] },
			value: '20261015T090000',
		});
		expect(parseContentLine('DESCRIPTION:a: b; c, d')).toEqual({
			name: 'DESCRIPTION',
			params: {},
			value: 'a: b; c, d',
		});
	});

	it('reads quoted parameter values that hold colons, semicolons and commas', () => {
		const line = parseContentLine(
			'ATTENDEE;CN="Doe, Jane: QA; lead";DELEGATED-TO="mailto:a@x.example","mailto:b@x.example":mailto:jane@x.example',
		);
		expect(line?.params.CN).toEqual(['Doe, Jane: QA; lead']);
		expect(line?.params['DELEGATED-TO']).toEqual(['mailto:a@x.example', 'mailto:b@x.example']);
		expect(line?.value).toBe('mailto:jane@x.example');
	});

	it('decodes RFC 6868 caret escapes in parameter values', () => {
		expect(parseContentLine("X-A;CN=Bob ^'the builder^' ^^ two^nlines:v")?.params.CN).toEqual([
			'Bob "the builder" ^ two\nlines',
		]);
	});

	it('refuses lines that are not content lines', () => {
		expect(parseContentLine('no colon here')).toBeNull();
		expect(parseContentLine(':value')).toBeNull();
		expect(parseContentLine('BAD NAME:value')).toBeNull();
		expect(parseContentLine('X;CN="open quote:value')).toBeNull();
	});

	it('unescapes TEXT values', () => {
		expect(unescapeText('a\\, b\\; c\\\\d\\ne\\Nf')).toBe('a, b; c\\d\ne\nf');
		expect(unescapeText('trailing\\')).toBe('trailing\\');
		expect(unescapeText('\\:colon')).toBe(':colon');
	});
});

describe('components', () => {
	it('builds the BEGIN/END tree', () => {
		const tree = readComponents(
			[
				'BEGIN:VCALENDAR',
				'VERSION:2.0',
				'BEGIN:VEVENT',
				'SUMMARY:a',
				'BEGIN:VALARM',
				'TRIGGER:-PT5M',
				'END:VALARM',
				'END:VEVENT',
				'END:VCALENDAR',
				'',
			].join('\r\n'),
		);
		expect(tree.unreadable).toBe(0);
		expect(tree.unclosed).toEqual([]);
		const [calendar] = tree.components;
		expect(calendar?.name).toBe('VCALENDAR');
		expect(calendar?.properties.map((p) => p.name)).toEqual(['VERSION']);
		const [event] = calendar?.components ?? [];
		expect(event?.properties.map((p) => p.value)).toEqual(['a']);
		expect(event?.components[0]?.name).toBe('VALARM');
	});

	it('closes what is left open, ignores stray ends and counts what it cannot read', () => {
		const tree = readComponents(
			'garbage\nSUMMARY:outside\nBEGIN:VCALENDAR\nEND:VTODO\nBEGIN:VEVENT\nBEGIN:VALARM\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:b',
		);
		expect(tree.unreadable).toBe(2);
		expect(tree.unclosed).toEqual(['VALARM', 'VCALENDAR', 'VEVENT']);
		expect(tree.components[0]?.components.map((c) => c.name)).toEqual(['VEVENT', 'VEVENT']);
		expect(tree.components[0]?.components[1]?.properties[0]?.value).toBe('b');
	});
});
