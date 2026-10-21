import { isEntityId } from 'ooxml-core/notebook';
import { notebookScope } from './store';

describe('notebook store helpers', () => {
	it('gives every database name its own scope, also names that clean up alike', () => {
		const names = ['notes.ada', 'notes/ada', 'notes-ada', 'x'.repeat(60), `${'x'.repeat(60)}y`];
		const scopes = names.map(notebookScope);
		expect(new Set(scopes).size).toBe(names.length);
		for (const scope of scopes) expect(isEntityId(scope) && scope.length <= 48).toBe(true);
		expect(notebookScope('notes.ada')).toBe(scopes[0]);
	});
});
