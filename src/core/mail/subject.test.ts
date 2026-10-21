import * as fc from 'fast-check';
import { baseSubject, forwardSubject, replySubject, type BaseSubject } from './subject';

/**
 * The base subject as RFC 5256 section 2.1 reads, step by step, cutting a new string each time:
 * plainly right but quadratic, so only for short subjects. `baseSubject` must agree with it.
 */
function referenceBaseSubject(subject: string): BaseSubject {
	const leaders = 're fwd fw aw wg sv vs antw tr rv res enc odp ynt'.split(' ');
	const blob = /^\[[^[\]]*\]\s*/;
	const refwd = /^([\p{L}]{1,6})\s*(?:\[[^[\]]*\])?\s*:\s*/u;
	const trailer = /\s*\(fwd\)\s*$/i;
	const stripLeaders = (subject: string): { rest: string; removed: boolean } => {
		let rest = subject;
		let removed = false;
		for (;;) {
			const before = rest;
			for (;;) {
				let probe = rest;
				while (blob.test(probe)) probe = probe.replace(blob, '');
				const match = refwd.exec(probe);
				if (!match || !leaders.includes(match[1]!.toLowerCase())) break;
				rest = probe.slice(match[0].length);
				removed = true;
			}
			const leading = blob.exec(rest);
			if (leading && rest.slice(leading[0].length).trim()) rest = rest.slice(leading[0].length);
			if (rest === before) return { rest, removed };
		}
	};
	let text = subject.replace(/\s+/g, ' ').trim();
	let isReplyOrForward = false;
	for (;;) {
		while (trailer.test(text)) {
			text = text.replace(trailer, '');
			isReplyOrForward = true;
		}
		const leading = stripLeaders(text);
		text = leading.rest;
		isReplyOrForward ||= leading.removed;
		const wrapped = /^\[fwd:\s*([\s\S]*)\]$/i.exec(text);
		if (!wrapped) break;
		text = wrapped[1]!.trim();
		isReplyOrForward = true;
	}
	text = text.trim();
	return { key: text.toLowerCase(), text, isReplyOrForward };
}

/** Pieces subjects are made of, markers, blobs and wrappers among them, to stack in any order. */
const PIECES = [
	...['[', ']', '[]', '][', '[x]', '[list] ', '[a b]', '[fwd:', '[FWD: ', '[Fwd:]'],
	...['Re', 're', 'RE', 'Re[2]', 'Fwd', 'FW', 'aw', 'Antw', 'SV', 'Reply', 'Note', 'ab', 'abcdefg'],
	...[':', ': ', ' ', '  ', '\t', '\n', ' ', '(fwd)', '(FWD)', ' (fwd)', '(fwd'],
	...['x', 'Hello', 'Ünï', 'Ål', '\u{1d411}e', 'Ⅻ', '中文', 'İ'],
];
const stacked = fc.array(fc.constantFrom(...PIECES), { maxLength: 24 }).map((p) => p.join(''));
/** A subject wrapped in layers, each a marker before it and an ending after it. */
const layered = fc
	.tuple(
		stacked,
		fc.array(
			fc.tuple(
				fc.constantFrom('[fwd:', '[Fwd: ', 'Re: ', 'Re[2]:', '[x] ', ''),
				fc.constantFrom(']', ' ]', ' (fwd)', '(fwd) ]', ' ', ''),
			),
			{ maxLength: 6 },
		),
	)
	.map(([inner, layers]) => layers.reduce((text, [before, after]) => before + text + after, inner));
const subjects = fc.oneof(
	stacked,
	layered,
	fc.string({ unit: fc.constantFrom(...'[]:() fwdrex\t'), maxLength: 40 }),
);

describe('baseSubject (RFC 5256 section 2.1)', () => {
	it.each([
		['Hello', 'hello', false],
		['Re: Hello', 'hello', true],
		['RE: re: Re[2]: Hello', 'hello', true],
		['Fwd: Hello', 'hello', true],
		['FW: Hello', 'hello', true],
		['Hello (fwd)', 'hello', true],
		['Hello (fwd) (FWD)', 'hello', true],
		['[list] Re: Hello', 'hello', true],
		['Re: [list] Hello', 'hello', true],
		['[fwd: Hello]', 'hello', true],
		['Re: [fwd: Re: Hello]', 'hello', true],
		['AW: WG: Hallo', 'hallo', true],
		['  Re:   Many    spaces  ', 'many spaces', true],
	])('%s -> %s', (subject, key, isReply) => {
		const result = baseSubject(subject);
		expect(result.key).toBe(key);
		expect(result.isReplyOrForward).toBe(isReply);
	});

	it('keeps a blob that is the whole subject', () => {
		expect(baseSubject('[announce]').key).toBe('[announce]');
	});

	it('keeps words that only look like a marker', () => {
		expect(baseSubject('Note: the agenda').key).toBe('note: the agenda');
		expect(baseSubject('Reply to all').key).toBe('reply to all');
	});

	it('leaves an empty subject empty', () => {
		expect(baseSubject('Re: ').key).toBe('');
		expect(baseSubject('').key).toBe('');
	});

	it('agrees with a step-by-step reading of the rules on any stack of markers', () => {
		fc.assert(
			fc.property(subjects, (subject) => {
				expect(baseSubject(subject)).toEqual(referenceBaseSubject(subject));
			}),
			{ numRuns: 4000 },
		);
	});

	it('takes linear time however many blobs, markers or wrappers a sender stacks', () => {
		const n = 20_000;
		const cases: [subject: string, key: string, isReplyOrForward: boolean][] = [
			[`${'[x] '.repeat(n)}notice`, 'notice', false],
			['[x]'.repeat(n), '[x]', false],
			[`${'[x] Re: '.repeat(n)}notice`, 'notice', true],
			[`${'Re[x]: '.repeat(n)}notice`, 'notice', true],
			[`notice${' (fwd)'.repeat(n)}`, 'notice', true],
			[`${'[fwd: '.repeat(n)}notice${']'.repeat(n)}`, 'notice', true],
			[`${'[fwd: [x] '.repeat(n)}notice${' (fwd)]'.repeat(n)}`, 'notice', true],
			[`[${'x'.repeat(5 * n)}`, `[${'x'.repeat(5 * n)}`, false],
			[`${'['.repeat(n)}notice`, `${'['.repeat(n)}notice`, false],
		];
		const started = performance.now();
		for (const [subject, key, isReplyOrForward] of cases)
			expect(baseSubject(subject)).toMatchObject({ key, isReplyOrForward });
		expect(performance.now() - started).toBeLessThan(1000);
	});
});

describe('reply and forward subjects', () => {
	it('adds Re: once', () => {
		expect(replySubject('Lunch')).toBe('Re: Lunch');
		expect(replySubject('Re: Lunch')).toBe('Re: Lunch');
		expect(replySubject('RE[3]: Lunch')).toBe('RE[3]: Lunch');
	});
	it('always adds Fwd:', () => {
		expect(forwardSubject('Re: Lunch')).toBe('Fwd: Re: Lunch');
	});
});
