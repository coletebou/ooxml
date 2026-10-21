// localStorage that never throws (private windows, blocked cookies, quota), for the small
// per-browser conveniences the apps remember. Moved from the team workspace's app storage so other
// products use it without importing the team workspace.

export interface SafeStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

export const safeStorage: SafeStorage = {
	getItem(key) {
		try {
			return globalThis.localStorage?.getItem(key) ?? null;
		} catch {
			return null;
		}
	},
	setItem(key, value) {
		try {
			globalThis.localStorage?.setItem(key, value);
		} catch {
			// Blocked or over quota: the convenience is lost, the app keeps working.
		}
	},
};
