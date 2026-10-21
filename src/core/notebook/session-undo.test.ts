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
});
