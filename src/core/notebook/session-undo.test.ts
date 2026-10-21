import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { keepFilled } from './session';

describe('notebook undo', () => {
	it('keeps the text a collaborator typed into a paragraph when its creation is undone', () => {
		const doc = new Y.Doc();
		const fragment = doc.getXmlFragment('text');
		const undo = new Y.UndoManager(fragment, {
			trackedOrigins: new Set(['local']),
			deleteFilter: keepFilled,
		});
		const paragraph = new Y.XmlElement('paragraph');
		doc.transact(() => fragment.insert(0, [paragraph]), 'local');
		doc.transact(() => paragraph.insert(0, [new Y.XmlText('from a collaborator')]), 'remote');
		undo.undo();
		expect(fragment.toString()).toContain('from a collaborator');
		// An empty one goes as before.
		const empty = new Y.XmlElement('paragraph');
		undo.stopCapturing();
		doc.transact(() => fragment.insert(1, [empty]), 'local');
		undo.undo();
		expect(fragment.length).toBe(1);
	});

	it('keeps a text box a collaborator wrote in when its creation is undone', () => {
		const doc = new Y.Doc();
		const boxes = doc.getMap('containers');
		const undo = new Y.UndoManager(boxes, {
			trackedOrigins: new Set(['local']),
			deleteFilter: keepFilled,
		});
		const box = new Y.Map();
		const content = new Y.XmlFragment();
		doc.transact(() => {
			boxes.set('c1', box);
			box.set('content', content);
		}, 'local');
		doc.transact(() => {
			const p = new Y.XmlElement('paragraph');
			content.insert(0, [p]);
			p.insert(0, [new Y.XmlText('theirs')]);
		}, 'remote');
		undo.undo();
		expect(boxes.has('c1')).toBe(true);
	});

	it('keeps a list and a text box with all its fields when a collaborator wrote in them', () => {
		const doc = new Y.Doc();
		const boxes = doc.getMap('containers');
		const undo = new Y.UndoManager(boxes, {
			trackedOrigins: new Set(['local']),
			deleteFilter: keepFilled,
		});
		const box = new Y.Map();
		const content = new Y.XmlFragment();
		const item = new Y.XmlElement('list_item');
		doc.transact(() => {
			boxes.set('c1', box);
			box.set('page', 'p1');
			box.set('x', 10);
			box.set('content', content);
			const list = new Y.XmlElement('bullet_list');
			content.insert(0, [list]);
			list.insert(0, [item]);
		}, 'local');
		doc.transact(() => {
			const p = new Y.XmlElement('paragraph');
			item.insert(0, [p]);
			p.insert(0, [new Y.XmlText('theirs')]);
		}, 'remote');
		undo.undo();
		expect(box.get('page')).toBe('p1');
		expect(box.get('x')).toBe(10);
		expect(content.toString()).toContain('theirs');
	});

	it("still undoes moving a box with text, and keeps a page with a collaborator's box on it", () => {
		const doc = new Y.Doc();
		const boxes = doc.getMap('notebook:containers');
		const pages = doc.getMap('notebook:pages');
		const undo = new Y.UndoManager([boxes, pages], {
			trackedOrigins: new Set(['local']),
			deleteFilter: keepFilled,
			captureTimeout: 0,
		});
		const box = new Y.Map();
		const content = new Y.XmlFragment();
		doc.transact(() => {
			boxes.set('c1', box);
			box.set('x', 10);
			box.set('content', content);
			const p = new Y.XmlElement('paragraph');
			content.insert(0, [p]);
			p.insert(0, [new Y.XmlText('mine')]);
		}, 'remote');
		doc.transact(() => box.set('x', 50), 'local');
		undo.undo();
		expect(box.get('x')).toBe(10);
		const page = new Y.Map();
		doc.transact(() => {
			pages.set('p9', page);
			page.set('title', 'Mine');
		}, 'local');
		doc.transact(() => {
			const theirs = new Y.Map();
			boxes.set('c2', theirs);
			theirs.set('page', 'p9');
		}, 'remote');
		undo.undo();
		expect(pages.has('p9')).toBe(true);
		expect(page.get('title')).toBe('Mine');
	});
});
