// Hooks the browser tests (e2e/notebook) can drive in every framework demo, so one spec checks
// each binding the same way: the host class the demo passes to its binding, a way to swap it, and
// a record of the binding's callbacks. They do nothing until a test reads or calls them. The
// detail shapes are written out here so the shared file needs no framework or ooxml import.

/** The host class every demo gives the notebook element through its binding. */
export const HOST_CLASS = 'demo-notebook-host';

interface FileDetail {
	name: string;
	mime: string;
	kind: string;
	bytes: Uint8Array;
}
interface ExportDetail {
	fileName: string;
	mime: string;
	kind: string;
	bytes: Uint8Array;
}

/** One callback the binding called, with the type of the event it passed (if any). */
export interface BindingCall {
	detail: Record<string, unknown>;
	eventType: string | undefined;
}

interface DemoHooks {
	setHostClass(value: string): void;
	ready: BindingCall[];
	navigations: BindingCall[];
	openedFiles: BindingCall[];
	exports: BindingCall[];
}

declare global {
	interface Window {
		notebookDemo?: DemoHooks;
	}
}

let hostClass = HOST_CLASS;
const listeners = new Set<(value: string) => void>();
const hooks: DemoHooks = {
	setHostClass(value) {
		hostClass = value;
		for (const listener of listeners) listener(value);
	},
	ready: [],
	navigations: [],
	openedFiles: [],
	exports: [],
};
window.notebookDemo = hooks;

/** The current host class. */
export const currentHostClass = (): string => hostClass;

/** Call `listener` whenever a test swaps the host class; returns the unsubscribe function. */
export function onHostClass(listener: (value: string) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

// Bytes are recorded by size: a spec compares names and kinds, not megabytes of arrays.
export const recordReady = (detail: { user: { id: string; name: string } }): void => {
	hooks.ready.push({ detail: { ...detail }, eventType: undefined });
};
export const recordNavigate = (detail: object): void => {
	hooks.navigations.push({ detail: { ...detail }, eventType: undefined });
};
export function recordOpenFile({ bytes, ...detail }: FileDetail, event?: Event): void {
	hooks.openedFiles.push({ detail: { ...detail, size: bytes.length }, eventType: event?.type });
}
export function recordExport({ bytes, ...detail }: ExportDetail, event?: Event): void {
	hooks.exports.push({ detail: { ...detail, size: bytes.length }, eventType: event?.type });
}
