import {
	formatAddrSpec,
	formatAddressList,
	formatMessageIds,
	parseAddressList,
	parseContentId,
	parseMessageIds,
} from './addresses';

const address = (name: string, email: string) => ({ name, email });

describe('parseAddressList', () => {
	it('reads the mailboxes of RFC 5322 A.1.2', () => {
		expect(parseAddressList('"Joe Q. Public" <john.q.public@example.com>')).toEqual([
			address('Joe Q. Public', 'john.q.public@example.com'),
		]);
		expect(
			parseAddressList('Mary Smith <mary@x.test>, jdoe@example.org, Who? <one@y.test>'),
		).toEqual([
			address('Mary Smith', 'mary@x.test'),
			address('', 'jdoe@example.org'),
			address('Who?', 'one@y.test'),
		]);
		expect(
			parseAddressList('<boss@nil.test>, "Giant; \\"Big\\" Box" <sysservices@example.net>'),
		).toEqual([
			address('', 'boss@nil.test'),
			address('Giant; "Big" Box', 'sysservices@example.net'),
		]);
	});

	it('flattens groups into their members (A.1.3)', () => {
		expect(
			parseAddressList('A Group:Ed Jones <c@a.test>,joe@where.test,John <jdoe@one.test>;'),
		).toEqual([
			address('Ed Jones', 'c@a.test'),
			address('', 'joe@where.test'),
			address('John', 'jdoe@one.test'),
		]);
		expect(parseAddressList('Undisclosed recipients:;')).toEqual([]);
		expect(parseAddressList('Team: a@x.test;, b@y.test')).toEqual([
			address('', 'a@x.test'),
			address('', 'b@y.test'),
		]);
	});

	it('reads quoted display names holding specials (A.2)', () => {
		expect(parseAddressList('"Mary Smith: Personal Account" <smith@home.example>')).toEqual([
			address('Mary Smith: Personal Account', 'smith@home.example'),
		]);
	});

	it('reads the white space, comments and oddities of A.5', () => {
		expect(
			parseAddressList('Pete(A nice \\) chap) <pete(his account)@silly.test(his host)>'),
		).toEqual([address('Pete', 'pete@silly.test')]);
		const to =
			"A Group(Some people)\r\n     :Chris Jones <c@(Chris's host.)public.example>,\r\n         joe@example.org,\r\n  John <jdoe@one.test> (my dear friend); (the end of the group)";
		expect(parseAddressList(to)).toEqual([
			address('Chris Jones', 'c@public.example'),
			address('', 'joe@example.org'),
			address('John', 'jdoe@one.test'),
		]);
		expect(
			parseAddressList('(Empty list)(start)Hidden recipients  :(nobody(that I know))  ;'),
		).toEqual([]);
	});

	it('reads the obsolete forms of A.6.1 and A.6.3', () => {
		expect(parseAddressList('Joe Q. Public <john.q.public@example.com>')).toEqual([
			address('Joe Q. Public', 'john.q.public@example.com'),
		]);
		expect(
			parseAddressList('Mary Smith <@node.test:mary@example.net>, , jdoe@test  . example'),
		).toEqual([address('Mary Smith', 'mary@example.net'), address('', 'jdoe@test.example')]);
		expect(parseAddressList('<@a.test,@b.test:ada@example.com>')).toEqual([
			address('', 'ada@example.com'),
		]);
		expect(parseAddressList('John Doe <jdoe@machine(comment).  example>')).toEqual([
			address('John Doe', 'jdoe@machine.example'),
		]);
		expect(parseAddressList('Mary Smith\r\n  \r\n          <mary@example.net>')).toEqual([
			address('Mary Smith', 'mary@example.net'),
		]);
	});

	it('decodes display names, also quoted ones, and RFC 6532 UTF-8', () => {
		expect(parseAddressList('=?UTF-8?Q?Ren=C3=A9e?= Dupont <renee@example.fr>')).toEqual([
			address('Renée Dupont', 'renee@example.fr'),
		]);
		expect(parseAddressList('"=?UTF-8?B?UmVuw6ll?=" <renee@example.fr>')).toEqual([
			address('Renée', 'renee@example.fr'),
		]);
		expect(parseAddressList('Zoë Ünal <zoë@exämple.com>')).toEqual([
			address('Zoë Ünal', 'zoë@exämple.com'),
		]);
	});

	it('keeps an encoded word whole even when an encoder left specials in it', () => {
		expect(
			parseAddressList('=?UTF-8?Q?Doe,_John?= <john@example.com>, "X" <x@example.com>'),
		).toEqual([address('Doe, John', 'john@example.com'), address('X', 'x@example.com')]);
		expect(parseAddressList('=?UTF-8?Q?Mr._Smith?= <smith@example.com>')).toEqual([
			address('Mr. Smith', 'smith@example.com'),
		]);
	});

	it('takes a comment after a bare address as its name (RFC 8621 section 4.1.2.3)', () => {
		expect(parseAddressList('ada@example.com (Ada Lovelace), grace@example.org')).toEqual([
			address('Ada Lovelace', 'ada@example.com'),
			address('', 'grace@example.org'),
		]);
	});

	it('keeps quotes on a local part only when it needs them', () => {
		expect(parseAddressList('"john doe"@example.com, "ada"@example.com')).toEqual([
			address('', '"john doe"@example.com'),
			address('', 'ada@example.com'),
		]);
	});

	it('never throws on garbage and keeps what it can read', () => {
		expect(parseAddressList('Ada <ada@example.com, Bob <bob@example.com>')).toEqual([
			address('Ada', 'ada@example.com'),
			address('Bob', 'bob@example.com'),
		]);
		expect(parseAddressList(',,,')).toEqual([]);
		expect(parseAddressList('Ada Lovelace')).toEqual([address('Ada Lovelace', '')]);
		expect(parseAddressList('postmaster')).toEqual([address('', 'postmaster')]);
		expect(parseAddressList(undefined)).toEqual([]);
		expect(() => parseAddressList('<<<>>>@@@;;;:::"(((\\')).not.toThrow();
	});
});

describe('formatAddressList', () => {
	it('quotes and encodes names as needed, and reads back the same list', () => {
		const list = [
			address('Ada Lovelace', 'ada@example.com'),
			address('', 'grace@example.org'),
			address('Lovelace, Ada', 'ada2@example.com'),
			address('Renée Dupont', 'renee@example.fr'),
			address('Giant; "Big" Box', 'box@example.net'),
			address('', '"john doe"@example.com'),
		];
		const written = formatAddressList(list);
		expect(written).toBe(
			'Ada Lovelace <ada@example.com>, grace@example.org, "Lovelace, Ada" <ada2@example.com>, =?UTF-8?Q?Ren=C3=A9e_Dupont?= <renee@example.fr>, "Giant; \\"Big\\" Box" <box@example.net>, "john doe"@example.com',
		);
		expect(parseAddressList(written)).toEqual(list);
	});

	it('leaves out addresses without an email, and no value can add another address', () => {
		expect(formatAddressList([address('Nobody', '')])).toBe('');
		const written = formatAddressList([address('Mallory', 'm@example.com>, victim@example.org')]);
		expect(parseAddressList(written)).toHaveLength(1);
		expect(formatAddrSpec('a@exa mple.com>\r\nBcc: x')).toBe('a@example.comBccx');
		expect(formatAddrSpec('ada@[192.0.2.1]')).toBe('ada@[192.0.2.1]');
		expect(formatAddrSpec('no domain')).toBe('"no domain"');
	});
});

describe('message ids', () => {
	it('reads msg-id lists without angle brackets (RFC 5322 section 3.6.4, A.2)', () => {
		expect(parseMessageIds('<1234@local.machine.example> <3456@example.net>')).toEqual([
			'1234@local.machine.example',
			'3456@example.net',
		]);
	});

	it('removes the comments and white space of the obsolete syntax (A.6.3)', () => {
		expect(parseMessageIds('<1234   @   local(blah)  .machine .example>')).toEqual([
			'1234@local.machine.example',
		]);
	});

	it('ignores phrases between ids and finds ids written without brackets', () => {
		expect(parseMessageIds('Your message of "Mon, 05 Jan 2026" <a@example.com> (comment)')).toEqual(
			['a@example.com'],
		);
		expect(parseMessageIds('a@example.com, b@example.com')).toEqual([
			'a@example.com',
			'b@example.com',
		]);
		expect(parseMessageIds('<unclosed@example.com')).toEqual(['unclosed@example.com']);
		expect(parseMessageIds('no ids here')).toEqual([]);
		expect(parseMessageIds(undefined)).toEqual([]);
	});

	it('writes ids in brackets without anything that could break the field', () => {
		expect(formatMessageIds(['a@example.com', '<b@example.com>', ' ', 'c @x\r\n.test'])).toBe(
			'<a@example.com> <b@example.com> <c@x.test>',
		);
	});

	it('reads Content-ID with or without brackets', () => {
		expect(parseContentId('<logo@example.com>')).toBe('logo@example.com');
		expect(parseContentId('image001')).toBe('image001');
		expect(parseContentId(' <part1.abc> (comment)')).toBe('part1.abc');
		expect(parseContentId(undefined)).toBeNull();
		expect(parseContentId('<>')).toBeNull();
	});
});
