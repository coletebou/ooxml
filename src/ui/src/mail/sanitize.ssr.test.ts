// @vitest-environment node
import { sanitizeEmailHtml } from './sanitize';

describe('the message sanitiser without a DOM', () => {
	it('gives an empty message each time, and never throws', () => {
		// On a server or in a worker, as when ooxml-ui/mail is imported for rendering elsewhere.
		expect(typeof document).toBe('undefined');
		const empty = {
			sheets: [],
			body: '',
			htmlAttributes: {},
			bodyAttributes: {},
			blocked: 0,
			cids: [],
		};
		for (let i = 0; i < 2; i++)
			expect(sanitizeEmailHtml('<p>Hello</p>', { allowRemote: false })).toEqual(empty);
	});
});
