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
});
