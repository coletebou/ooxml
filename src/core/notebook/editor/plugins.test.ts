import { EditorState, TextSelection } from 'prosemirror-state';
import { ySyncPluginKey } from 'y-prosemirror';
import { describe, expect, it } from 'vitest';
import { textLimitPlugin } from './plugins';
import { notebookSchema as schema } from './schema';

function state(text: string): EditorState {
	const doc = schema.nodeFromJSON({
		type: 'doc',
		content: [{ type: 'paragraph', attrs: { todo: null }, content: [{ type: 'text', text }] }],
	});
	return EditorState.create({
		schema,
		doc,
		selection: TextSelection.create(doc, 1 + text.length),
		plugins: [textLimitPlugin(10)],
	});
}

describe('schema output', () => {
	it('renders headings with a fixed tag, whatever level a collaborator wrote', () => {
		const heading = (level: unknown) =>
			schema.nodes.heading!.spec.toDOM!(schema.nodes.heading!.create({ level }));
		expect((heading(2) as readonly unknown[])[0]).toBe('h2');
		expect((heading('ttp://www.w3.org/1999/xhtml script') as readonly unknown[])[0]).toBe('h1');
		expect((heading(7) as readonly unknown[])[0]).toBe('h1');
	});
});

describe('text limit', () => {
	it('stops local typing at the limit and always lets text shrink', () => {
		const full = state('0123456789');
		expect(full.apply(full.tr.insertText('x')).doc.textContent).toBe('0123456789');
		expect(full.apply(full.tr.delete(1, 3)).doc.textContent).toBe('23456789');
		const short = state('012345');
		expect(short.apply(short.tr.insertText('6789')).doc.textContent).toBe('0123456789');
		expect(short.apply(short.tr.insertText('6789x')).doc.textContent).toBe('012345');
	});

	it('applies changes from collaborators and undo whatever their length', () => {
		const full = state('0123456789');
		const remote = full.tr.insertText('more').setMeta(ySyncPluginKey, { isChangeOrigin: true });
		expect(full.apply(remote).doc.textContent).toBe('0123456789more');
	});
});
