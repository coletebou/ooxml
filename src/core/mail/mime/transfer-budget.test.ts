import * as base64 from '../../digest/base64';
import { decodeBase64Body } from './transfer';

// The strict decoder is watched, so the test sees how often a body is decoded piece by piece.
vi.mock('../../digest/base64', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../digest/base64')>();
	return { ...actual, decodeBase64: vi.fn(actual.decodeBase64) };
});

afterEach(() => {
	vi.mocked(base64.decodeBase64).mockClear();
});

describe('the memory decodeBase64Body takes', () => {
	it('decodes a body padded in the middle again and again in one pass, not piece by piece', () => {
		const pieces = 100_000;
		const decoded = decodeBase64Body(new TextEncoder().encode('QQ=='.repeat(pieces)));
		expect(decoded).toEqual(new Uint8Array(pieces).fill(0x41));
		// Each piece decoded on its own was a string and an array of its own, all kept to the end.
		expect(vi.mocked(base64.decodeBase64).mock.calls.length).toBeLessThanOrEqual(1);
	});
});
