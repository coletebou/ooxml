import { baseSubject, forwardSubject, replySubject } from './subject';

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
