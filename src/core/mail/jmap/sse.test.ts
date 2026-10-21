import { createSseParser, type SseEvent } from './sse';

function parse(chunks: readonly string[]): { events: SseEvent[]; retries: number[] } {
	const events: SseEvent[] = [];
	const retries: number[] = [];
	const parser = createSseParser({
		event: (event) => events.push(event),
		retry: (ms) => retries.push(ms),
	});
	for (const chunk of chunks) parser.push(chunk);
	parser.end();
	return { events, retries };
}

const STATE =
	'event: state\ndata: {"@type":"StateChange","changed":{"a3123":{"Email":"d35ecb040aab"}}}\nid: 1\n\n';

describe('createSseParser', () => {
	it('reads a JMAP state event (RFC 8620 7.3)', () => {
		expect(parse([STATE]).events).toEqual([
			{
				type: 'state',
				data: '{"@type":"StateChange","changed":{"a3123":{"Email":"d35ecb040aab"}}}',
				lastEventId: '1',
			},
		]);
	});

	it('gives the same events however the stream is split', () => {
		const whole = parse([
			STATE,
			': keep-alive\r\n',
			'event: ping\r\ndata: {"interval":60}\r\n\r\n',
		]).events;
		const text = `${STATE}: keep-alive\r\nevent: ping\r\ndata: {"interval":60}\r\n\r\n`;
		for (let size = 1; size <= 7; size++) {
			const chunks: string[] = [];
			for (let at = 0; at < text.length; at += size) chunks.push(text.slice(at, at + size));
			expect(parse(chunks).events).toEqual(whole);
		}
		expect(whole.map((event) => event.type)).toEqual(['state', 'ping']);
	});

	it('joins multi-line data with line feeds and takes one leading space off a value', () => {
		expect(parse(['data:first\ndata:  second\ndata\n\n']).events).toEqual([
			{ type: 'message', data: 'first\n second\n', lastEventId: '' },
		]);
	});

	it('handles CR, LF and CRLF line endings, a CRLF split across chunks included', () => {
		expect(
			parse(['data: a\r', '\n\r', '\ndata: b\r\rdata: c\n\n']).events.map((event) => event.data),
		).toEqual(['a', 'b', 'c']);
	});

	it('ignores comments, unknown fields and events without data', () => {
		expect(parse([':comment\nfoo: bar\nevent: nothing\n\nretry: soon\n\n']).events).toEqual([]);
	});

	it('reports retry times and keeps the last event id across events', () => {
		const { events, retries } = parse([
			'retry: 2500\nid: 7\ndata: x\n\ndata: y\n\nid: bad\0id\ndata: z\n\n',
		]);
		expect(retries).toEqual([2500]);
		expect(events.map((event) => event.lastEventId)).toEqual(['7', '7', '7']);
	});

	it('drops a half-received event at the end and a leading byte order mark', () => {
		expect(parse(['\uFEFFdata: done\n\n', 'data: never finished\n']).events).toEqual([
			{ type: 'message', data: 'done', lastEventId: '' },
		]);
	});
});
