// Per-browser conveniences in localStorage: who I am and the server settings. Every access is
// guarded: storage can be blocked or full, and the app must work without it.
import { type TeamsServerConfig, parseServerConfig } from 'ooxml-core/teams';

import { safeStorage } from '../../safe-storage';

export { safeStorage };

export interface Identity {
	id: string;
	name: string;
}

export function loadIdentity(): Identity | null {
	try {
		const raw = JSON.parse(
			safeStorage.getItem('teams:identity') ?? 'null',
		) as Partial<Identity> | null;
		if (raw && typeof raw.id === 'string' && typeof raw.name === 'string' && raw.name.trim())
			return { id: raw.id, name: raw.name };
	} catch {
		// fall through
	}
	return null;
}
export const saveIdentity = (identity: Identity): void =>
	safeStorage.setItem('teams:identity', JSON.stringify(identity));

export function loadConfig(): TeamsServerConfig | null {
	const raw = safeStorage.getItem('teams:config');
	if (!raw) return null;
	try {
		return parseServerConfig(JSON.parse(raw)).config;
	} catch {
		return null;
	}
}
export const saveConfig = (config: TeamsServerConfig): void =>
	safeStorage.setItem('teams:config', JSON.stringify(config));
