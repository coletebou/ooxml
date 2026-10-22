import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { notebookCopy, removeNotebookCopy } from './journal';
import { type NotebookStorage, createMemoryStorage, notebookKey } from './storage';

const STORED = Symbol('stored');

/** A document whose `doc.on('update')` changes are gathered, as the session gathers them. */
function tracked() {
	const doc = new Y.Doc();
	let changes: Uint8Array[] = [];
	doc.on('update', (update: Uint8Array, origin: unknown) => {
		if (origin !== STORED) changes.push(update);
	});
	return {
		doc,
		take: (): Uint8Array => {
			const out = Y.mergeUpdates(changes);
			changes = [];
			return out;
		},
	};
}

const bytesOf = async (storage: ReturnType<typeof createMemoryStorage>) => {
	let total = 0;
	for (const key of storage.keys()) total += (await storage.load(key))?.length ?? 0;
	return total;
};

async function reopen(storage: NotebookStorage, id = 'n1') {
	const doc = new Y.Doc();
	await notebookCopy(storage, id).load(doc, STORED);
	return doc;
}

describe('a notebook kept as a log', () => {
	it('saves only what changed, however much the notebook holds', async () => {
		const storage = createMemoryStorage();
		const copy = notebookCopy(storage, 'n1');
		const { doc, take } = tracked();
		await copy.load(doc, STORED);
		doc.getMap('assets').set('file', new Uint8Array(1_000_000));
		await copy.save(doc, take());
		const before = await bytesOf(storage);
		doc.getText('t').insert(0, 'x');
		await copy.save(doc, take());
		expect((await bytesOf(storage)) - before).toBeLessThan(100);
		expect((await reopen(storage)).getText('t').toString()).toBe('x');
	});

	it('drops deleted content from storage when it compacts', async () => {
		const storage = createMemoryStorage();
		const copy = notebookCopy(storage, 'n1');
		const { doc, take } = tracked();
		await copy.load(doc, STORED);
		doc.getMap('assets').set('file', new Uint8Array(1_000_000));
		await copy.save(doc, take());
		doc.getMap('assets').delete('file');
		await copy.save(doc, take());
		// The next open folds the pieces into one base made from the document.
		const again = await reopen(storage);
		expect(again.getMap('assets').has('file')).toBe(false);
		expect(await bytesOf(storage)).toBeLessThan(1000);
		expect(storage.keys()).toHaveLength(1);
	});

	it('keeps the saves of two clients on one storage that cannot reach each other', async () => {
		const storage = createMemoryStorage();
		const a = tracked();
		const b = tracked();
		const copyA = notebookCopy(storage, 'n1');
		const copyB = notebookCopy(storage, 'n1');
		await copyA.load(a.doc, STORED);
		await copyB.load(b.doc, STORED);
		a.doc.getText('t').insert(0, 'A');
		b.doc.getMap('m').set('b', 1);
		await Promise.all([copyA.save(a.doc, a.take()), copyB.save(b.doc, b.take())]);
		const both = await reopen(storage);
		expect([both.getText('t').toString(), both.getMap('m').get('b')]).toEqual(['A', 1]);
	});

	it('removes on compaction only what it read or wrote, never a newer save of another', async () => {
		const inner = createMemoryStorage();
		let during: (() => Promise<void>) | null = null;
		// Another client saves while this one compacts: after its base is stored, before it removes.
		const storage: NotebookStorage = {
			...inner,
			save: async (key, bytes) => {
				await inner.save(key, bytes);
				const run = key.includes(':b:') ? during : null;
				during = null;
				await run?.();
			},
		};
		// Two bases, as two clients that compacted at once leave: this open folds them.
		const docA = new Y.Doc();
		docA.getText('t').insert(0, 'base');
		const docB = new Y.Doc();
		Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
		docB.getText('t').insert(4, '!');
		await inner.save(`${notebookKey('n1')}:b:one`, Y.encodeStateAsUpdate(docA));
		await inner.save(`${notebookKey('n1')}:b:two`, Y.encodeStateAsUpdate(docB));
		const late = new Y.Doc();
		late.getMap('m').set('late', true);
		during = () => inner.save(`${notebookKey('n1')}:u:late`, Y.encodeStateAsUpdate(late));
		// Two pieces stored: this open compacts them.
		const a = tracked();
		await notebookCopy(storage, 'n1').load(a.doc, STORED);
		expect(inner.keys()).toContain(`${notebookKey('n1')}:u:late`);
		const all = await reopen(storage);
		expect([all.getText('t').toString(), all.getMap('m').get('late')]).toEqual(['base!', true]);
	});

	it('opens after a small edit without rewriting the whole notebook', async () => {
		const inner = createMemoryStorage();
		const bases: number[] = [];
		const storage: NotebookStorage = {
			...inner,
			save: async (key, bytes) => {
				if (key.includes(':b:')) bases.push(bytes.length);
				return inner.save(key, bytes);
			},
		};
		const copy = notebookCopy(storage, 'n1');
		const { doc, take } = tracked();
		await copy.load(doc, STORED);
		doc.getMap('assets').set('file', new Uint8Array(1_000_000));
		await copy.save(doc, take());
		// One base holds the file now.
		await notebookCopy(storage, 'n1').load(new Y.Doc(), STORED);
		expect(bases).toHaveLength(1);
		// A session types a little; the next open reads base and entry, and writes no base.
		const again = tracked();
		const second = notebookCopy(storage, 'n1');
		await second.load(again.doc, STORED);
		again.doc.getText('t').insert(0, 'a few words');
		await second.save(again.doc, again.take());
		const third = new Y.Doc();
		await notebookCopy(storage, 'n1').load(third, STORED);
		expect(bases).toHaveLength(1);
		expect(third.getText('t').toString()).toBe('a few words');
	});

	it('reads the one copy an older version kept and folds it into the log', async () => {
		const storage = createMemoryStorage();
		const old = new Y.Doc();
		old.getText('t').insert(0, 'from before');
		await storage.save(notebookKey('n1'), Y.encodeStateAsUpdate(old));
		const doc = await reopen(storage);
		expect(doc.getText('t').toString()).toBe('from before');
		// Read once more with nothing else stored: the base alone.
		expect(storage.keys().filter((k) => k === notebookKey('n1'))).toEqual([]);
		expect((await reopen(storage)).getText('t').toString()).toBe('from before');
	});

	it('compacts a long log into one base as it saves', async () => {
		const storage = createMemoryStorage();
		const copy = notebookCopy(storage, 'n1');
		const { doc, take } = tracked();
		await copy.load(doc, STORED);
		for (let i = 0; i < 600; i++) {
			doc.getText('t').insert(i, 'x');
			await copy.save(doc, take());
		}
		expect(storage.keys().length).toBeLessThan(200);
		expect((await reopen(storage)).getText('t').length).toBe(600);
	});

	it('waits longer after a compaction fails, instead of rewriting the notebook every save', async () => {
		const inner = createMemoryStorage();
		const bases: number[] = [];
		// Bases do not fit any more; small entries still do.
		const storage: NotebookStorage = {
			...inner,
			save: async (key, bytes) => {
				if (key.includes(':b:')) {
					bases.push(bytes.length);
					throw new Error('quota exceeded');
				}
				return inner.save(key, bytes);
			},
		};
		const copy = notebookCopy(storage, 'n1');
		const { doc, take } = tracked();
		await copy.load(doc, STORED);
		for (let i = 0; i < 2000; i++) {
			doc.getText('t').insert(i, 'x');
			await copy.save(doc, take());
		}
		// Due at 500 entries, then at 1000 and 2000 more: three tries, not 1500.
		expect(bases.length).toBeLessThanOrEqual(3);
		expect((await reopen(inner)).getText('t').length).toBe(2000);
	});

	it('keeps one merged copy on a storage that cannot read key ranges', async () => {
		const inner = createMemoryStorage();
		const storage: NotebookStorage = { load: inner.load, save: inner.save, remove: inner.remove };
		const copy = notebookCopy(storage, 'n1');
		const { doc, take } = tracked();
		await copy.load(doc, STORED);
		doc.getText('t').insert(0, 'one copy');
		await copy.save(doc, take());
		expect(inner.keys()).toEqual([notebookKey('n1')]);
		expect((await reopen(storage)).getText('t').toString()).toBe('one copy');
	});

	it('removes all of a notebook, and nothing of another', async () => {
		const storage = createMemoryStorage();
		for (const id of ['n1', 'n10']) {
			const copy = notebookCopy(storage, id);
			const { doc, take } = tracked();
			await copy.load(doc, STORED);
			doc.getText('t').insert(0, id);
			await copy.save(doc, take());
		}
		await storage.save(notebookKey('n1'), new Uint8Array([0, 0]));
		await removeNotebookCopy(storage, 'n1');
		expect(storage.keys().every((k) => k.startsWith(`${notebookKey('n10')}:`))).toBe(true);
		expect((await reopen(storage, 'n10')).getText('t').toString()).toBe('n10');
	});
});
