// How an open notebook reaches its collaborators. `local` (the default) needs no server: the tabs
// of one browser share the notebook over BroadcastChannel. `server` speaks the y-websocket wire
// format to `<syncUrl>/<room>` (the Teams reference server's `/sync` endpoint, or any stock
// y-websocket server), with an optional shared token as `?token=`. DOM-free; browser classes are
// injectable. New code.
import {
	type BroadcastChannelConstructor,
	createBroadcastTransport,
} from '../collab/broadcast-transport';
import type { Transport } from '../collab/provider';
import { isMixedContentBlocked } from '../collab/validation';
import {
	type WebSocketConstructor,
	createWebSocketTransport,
	roomUrl,
} from '../collab/websocket-transport';
import { isEntityId } from './model';

export type NotebookSyncConfig =
	| { mode: 'local' }
	| { mode: 'server'; syncUrl: string; token?: string };

export interface SyncClasses {
	WebSocket?: WebSocketConstructor | undefined;
	BroadcastChannel?: BroadcastChannelConstructor | undefined;
}

/** A validated config and every problem found; never throws (a bad config falls back to local). */
export function parseSyncConfig(raw: unknown): { config: NotebookSyncConfig; problems: string[] } {
	const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	if (value.mode !== 'server') return { config: { mode: 'local' }, problems: [] };
	const problems: string[] = [];
	const url = typeof value.syncUrl === 'string' ? value.syncUrl.trim() : '';
	if (!/^wss?:\/\/[^\s/]+/iu.test(url)) problems.push('syncUrl must be a ws:// or wss:// URL');
	else if (isMixedContentBlocked(url))
		problems.push('An https page cannot connect to a ws:// server');
	const token = typeof value.token === 'string' ? value.token.trim() : '';
	if (token.length > 512) problems.push('The token is longer than 512 characters');
	if (problems.length) return { config: { mode: 'local' }, problems };
	return { config: { mode: 'server', syncUrl: url, ...(token ? { token } : {}) }, problems };
}

/** The sync room of a notebook. Collaborators share it, so it never depends on a local profile. */
export const notebookRoomId = (notebookId: string): string => `nb-${notebookId}`.slice(0, 128);

/** The registry's room: tabs of one profile only, never a server. */
export const registryRoomId = (scope = ''): string =>
	`nb-registry${scope ? `-${scope}` : ''}`.slice(0, 128);

export function createNotebookTransport(
	config: NotebookSyncConfig,
	roomId: string,
	classes: SyncClasses = {},
): Transport {
	if (config.mode === 'server') {
		const base = roomUrl(config.syncUrl, roomId);
		const url = config.token ? `${base}?token=${encodeURIComponent(config.token)}` : base;
		return createWebSocketTransport({
			url,
			...(classes.WebSocket ? { WebSocket: classes.WebSocket } : {}),
		});
	}
	return createBroadcastTransport({
		roomId,
		...(classes.BroadcastChannel ? { BroadcastChannel: classes.BroadcastChannel } : {}),
	});
}

/** A scope string usable in room ids (a suite profile id, for example). */
export function sanitizeScope(scope: unknown): string {
	return typeof scope === 'string' && isEntityId(scope) ? scope.slice(0, 48) : '';
}
