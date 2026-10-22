// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The component bindings are checked at the source: each routes props, events and the host class
// through bindMail. The first cut has React; add each framework here as it lands.
const bindings = { react: 'react/src/index.ts' } as const;
const classProp = { react: /className/ } as const;

const read = (file: string): string =>
	readFileSync(resolve(process.cwd(), 'packages', file), 'utf8');

describe.each(Object.entries(bindings))('%s binding', (name, file) => {
	const source = read(file);
	it('uses the shared bindMail wiring instead of its own copy', () => {
		expect(source).toContain('bindMail(');
		expect(source).toContain('pickMailProps(');
		expect(source).not.toContain('applyMailProps(');
		expect(source).not.toContain('listenMailEvents(');
	});
	it('accepts a host class', () => {
		expect(source).toMatch(classProp[name as keyof typeof classProp]);
	});
});

describe('shared props', () => {
	it('reach the element through the pickMailProps list', () => {
		expect(read('web-component/src/bind.ts')).toMatch(/\['config', 'locale', 'theme', 'view'\]/u);
	});
});
