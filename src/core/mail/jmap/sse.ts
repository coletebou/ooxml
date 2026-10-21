// A parser for `text/event-stream` (the server-sent events format of the HTML standard), fed decoded
// text in chunks split anywhere: `event`, multi-line `data`, `id` and `retry` fields, comments,
// and CRLF, LF or CR line endings, including a CRLF split between two chunks. New code.

export interface SseEvent {
	/** The `event` field, `message` when there is none. */
	type: string;
	/** The `data` lines, joined with line feeds. */
	data: string;
	/** The last `id` the stream has set, carried over from earlier events. */
	lastEventId: string;
}

export interface SseHandlers {
	event(event: SseEvent): void;
	/** A `retry` field: the reconnection time the server asks for, in milliseconds. */
	retry?(ms: number): void;
}

export interface SseParser {
	push(text: string): void;
	/** The stream ended: a half-received event is dropped, as the format requires. */
	end(): void;
}

export function createSseParser(handlers: SseHandlers): SseParser {
	let pending = '';
	let started = false;
	let afterCr = false;
	let type = '';
	let data = '';
	let lastEventId = '';

	const dispatch = (): void => {
		const event = { type: type || 'message', data: data.slice(0, -1), lastEventId };
		const hasData = data !== '';
		type = '';
		data = '';
		if (hasData) handlers.event(event);
	};

	const line = (text: string): void => {
		if (text === '') return dispatch();
		if (text.startsWith(':')) return;
		const colon = text.indexOf(':');
		const field = colon === -1 ? text : text.slice(0, colon);
		let value = colon === -1 ? '' : text.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'event') type = value;
		else if (field === 'data') data += `${value}\n`;
		else if (field === 'id' && !value.includes('\0')) lastEventId = value;
		else if (field === 'retry' && /^\d+$/.test(value)) handlers.retry?.(Number(value));
	};

	return {
		push(chunk) {
			let text = chunk;
			if (!started && text) {
				started = true;
				if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
			}
			// A CR that ended the last chunk pairs with an LF that starts this one, and with nothing
			// later: an LF after that pair is a line break of its own.
			if (afterCr && text) {
				afterCr = false;
				if (text.startsWith('\n')) text = text.slice(1);
			}
			const buffer = pending + text;
			let start = 0;
			for (let index = 0; index < buffer.length; index++) {
				const char = buffer[index];
				if (char !== '\n' && char !== '\r') continue;
				line(buffer.slice(start, index));
				if (char === '\r') {
					if (index + 1 === buffer.length) afterCr = true;
					else if (buffer[index + 1] === '\n') index++;
				}
				start = index + 1;
			}
			pending = buffer.slice(start);
		},
		end() {
			pending = '';
			type = '';
			data = '';
		},
	};
}
