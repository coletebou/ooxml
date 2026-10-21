import * as multipart from './multipart';
import { readEmail } from './parse';

// The scan is watched, so the test sees what it was asked to tell apart.
vi.mock('./multipart', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./multipart')>();
	return { ...actual, splitMultipart: vi.fn(actual.splitMultipart) };
});

const scans = () =>
	vi.mocked(multipart.splitMultipart).mock.results.map((result) => {
		if (result.type !== 'return') throw new Error('the scan failed');
		return result.value;
	});

afterEach(() => {
	vi.mocked(multipart.splitMultipart).mockClear();
});

describe('the part budget of readEmail', () => {
	it('tells no more parts apart than the budget leaves, however many the body holds', () => {
		const raw = `Content-Type: multipart/mixed; boundary=b\r\n\r\n${'--b\r\n'.repeat(100_000)}--b--\r\n`;
		const email = readEmail(raw, { maxParts: 5 });
		// The multipart itself is one part: four are read, the rest is kept as one.
		expect(scans().map((split) => split.parts.length)).toEqual([5]);
		expect(email.root.parts).toHaveLength(5);
		expect(email.root.parts[4]).toMatchObject({ type: 'application/octet-stream' });
	});

	it('hands a nested multipart only what is left of the budget', () => {
		const inner = `Content-Type: multipart/mixed; boundary=c\r\n\r\n${'--c\r\n\r\nx\r\n'.repeat(50)}--c--`;
		const raw = `Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\n${inner}\r\n--b\r\n\r\ny\r\n--b--\r\n`;
		readEmail(raw, { maxParts: 10 });
		// The outer one is part 1 and may hold 9; the inner one, part 2, may hold 8 more.
		expect(scans().map((split) => split.parts.length)).toEqual([2, 9]);
	});
});
