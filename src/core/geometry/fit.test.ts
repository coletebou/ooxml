import { describe, expect, it } from 'vitest';
import { containRect } from './fit';

describe('containRect', () => {
	it('fits content in a box in its own shape, centred', () => {
		expect(containRect({ width: 200, height: 100 }, { width: 100, height: 100 })).toEqual({
			x: 0,
			y: 25,
			width: 100,
			height: 50,
		});
		expect(containRect({ width: 10, height: 40 }, { width: 100, height: 100 })).toEqual({
			x: 37.5,
			y: 0,
			width: 25,
			height: 100,
		});
		// Smaller content grows to the box, as object-fit: contain does.
		expect(containRect({ width: 1, height: 1 }, { width: 50, height: 20 })).toEqual({
			x: 15,
			y: 0,
			width: 20,
			height: 20,
		});
		expect(containRect({ width: 0, height: 5 }, { width: 50, height: 20 })).toEqual({
			x: 0,
			y: 0,
			width: 50,
			height: 20,
		});
	});
});
