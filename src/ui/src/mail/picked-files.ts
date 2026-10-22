// Files a person picks or drops, read for the app: each on its own, so one the browser refuses
// leaves the others read, and is named. Used by the compose window and the .eml, .vcf and .ics
// imports. New code.
import type { FileInput } from 'ooxml-core/mail';

/** What `readEach` read, in the order picked, and the names of the files it could not read. */
export interface FilesRead<T> {
	read: T[];
	unreadable: string[];
}

/**
 * Picked or dropped files each read with `read` on its own. The browser refuses a file that was
 * deleted, moved or changed since it was picked (`NotReadableError`); such a file is left out and
 * named in `unreadable`, and the others are still read. Never rejects.
 */
export async function readEach<T>(
	files: Iterable<File> | null | undefined,
	read: (file: File) => Promise<T>,
): Promise<FilesRead<T>> {
	const list = [...(files ?? [])];
	const results = await Promise.allSettled(list.map(read));
	const out: FilesRead<T> = { read: [], unreadable: [] };
	results.forEach((result, i) => {
		if (result.status === 'fulfilled') out.read.push(result.value);
		else out.unreadable.push(list[i]!.name);
	});
	return out;
}

/** Picked or dropped files as the client takes them (name, type and bytes), as `readEach` reads. */
export const readFiles = (
	files: Iterable<File> | null | undefined,
): Promise<FilesRead<FileInput>> =>
	readEach(files, async (file) => ({
		name: file.name,
		type: file.type,
		bytes: new Uint8Array(await file.arrayBuffer()),
	}));
