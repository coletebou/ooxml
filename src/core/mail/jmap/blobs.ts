// Binary data over JMAP (RFC 8620 6): uploads to the session's upload URL, downloads from its
// download URL template, and `.eml` imports as an upload plus `Email/import` (RFC 8621 4.8).
// New code.
import { SEEN } from '../model';
import { MailTransportError, type UploadedBlob } from '../transport';
import type { JmapClient } from './client';
import { networkError } from './errors';
import { expandTemplate } from './urls';
import { patchPath } from './request';
import { isRecord } from './types';

export interface BlobMethods {
	upload(bytes: Uint8Array, type: string): Promise<UploadedBlob>;
	download(blobId: string, options: { type: string; name: string }): Promise<Uint8Array>;
	importMessage(bytes: Uint8Array, mailboxId: string): Promise<{ id: string }>;
}

/** The bytes as a request body (a copy only when they sit on a shared buffer). */
const bodyOf = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
	bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : new Uint8Array(bytes);

export function createBlobMethods(client: JmapClient, nudge: () => void): BlobMethods {
	const { http } = client;

	const upload = async (bytes: Uint8Array, type: string): Promise<UploadedBlob> => {
		const session = await client.session();
		if (bytes.byteLength > session.limits.maxSizeUpload)
			throw new MailTransportError('tooLarge', 'The file is larger than the server accepts.');
		const contentType = type || 'application/octet-stream';
		const what = 'The upload';
		const json = await http.exchange(
			expandTemplate(session.uploadUrl, { accountId: client.accountId() }),
			{
				method: 'POST',
				headers: { 'Content-Type': contentType, Accept: 'application/json' },
				body: bodyOf(bytes),
				gate: client.uploads,
				// Sent twice, the file is a second blob that nothing refers to and the server may drop.
				repeatable: true,
			},
			what,
			(response) => http.json(response, what),
		);
		if (!isRecord(json) || typeof json.blobId !== 'string' || !json.blobId)
			throw new MailTransportError('server', 'The upload response has no blob id.');
		return {
			blobId: json.blobId,
			type: typeof json.type === 'string' && json.type ? json.type : contentType,
			size: typeof json.size === 'number' ? json.size : bytes.byteLength,
		};
	};

	/**
	 * Whether the message `existingId` holds these bytes, the upload `blobId`: the same blob id (a
	 * server naming bytes by their content), else the same size and, read, the same bytes.
	 */
	const holds = async (existingId: string, bytes: Uint8Array, blobId: string): Promise<boolean> => {
		const { result, calls } = await client.request((builder, accountId) =>
			builder.call('Email/get', { accountId, ids: [existingId], properties: ['blobId', 'size'] }),
		);
		const list: unknown = result.get(calls).list;
		const email: unknown = Array.isArray(list) ? list[0] : undefined;
		if (!isRecord(email) || typeof email.blobId !== 'string') return false;
		if (email.blobId === blobId) return true;
		if (email.size !== bytes.byteLength) return false;
		const held = await methods.download(email.blobId, {
			type: 'message/rfc822',
			name: 'message.eml',
		});
		return held.byteLength === bytes.byteLength && held.every((byte, i) => byte === bytes[i]);
	};

	const methods: BlobMethods = {
		upload,

		async download(blobId, options) {
			const session = await client.session();
			const what = 'The download';
			const url = expandTemplate(session.downloadUrl, {
				accountId: client.accountId(),
				blobId,
				type: options.type || 'application/octet-stream',
				name: options.name || 'download',
			});
			return http.exchange(url, { method: 'GET' }, what, async (response) => {
				try {
					return new Uint8Array(await response.arrayBuffer());
				} catch (error) {
					throw networkError(what, error, http.redact);
				}
			});
		},

		async importMessage(bytes, mailboxId) {
			const { blobId } = await upload(bytes, 'message/rfc822');
			const { result, calls } = await client.request((builder, accountId) =>
				builder.call('Email/import', {
					accountId,
					emails: {
						eml: { blobId, mailboxIds: { [mailboxId]: true }, keywords: { [SEEN]: true } },
					},
				}),
			);
			const refused = result.get(calls).notCreated;
			const duplicate = isRecord(refused) ? refused.eml : undefined;
			if (
				isRecord(duplicate) &&
				duplicate.type === 'alreadyExists' &&
				typeof duplicate.existingId === 'string'
			) {
				// The account has this message already (RFC 8621 4.8): file that one in the mailbox. A
				// server may call one a duplicate by its Message-ID alone: only the same bytes are filed.
				const existing = duplicate.existingId;
				if (!(await holds(existing, bytes, blobId)))
					throw new MailTransportError(
						'invalid',
						'The account holds another message with the Message-ID of this one.',
					);
				const { result: filed, calls: set } = await client.request((builder, accountId) =>
					builder.call('Email/set', {
						accountId,
						update: { [existing]: { [patchPath('mailboxIds', mailboxId)]: true } },
					}),
				);
				filed.set(set);
				nudge();
				return { id: existing };
			}
			const id = result.created(calls, 'eml');
			nudge();
			return { id };
		},
	};
	return methods;
}
