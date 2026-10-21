// The raw, framework-neutral hook surface. Every binding wraps exactly this: create a client once,
// then read `getState()` and call its actions. Use it to build your own UI without <mail-app>.
//
//   const mail = createMail({ config: { kind: 'jmap', url: 'https://mail.example.com', auth } });
//   const stop = mail.subscribe(() => render(mail.getState()));
//   await mail.search('from:ada invoice');
import {
	createDemoSeed,
	createJmapTransport,
	createMailClient,
	createMemoryCalendarStore,
	createMemoryContactStore,
	createMemoryTransport,
	type CalendarStore,
	type ContactStore,
	type DemoSeedOptions,
	type JmapAuth,
	type KeyValueStorage,
	type MailClient,
	type MailTransport,
	type QuoteFormat,
} from 'ooxml-core/mail';

export type {
	ComposeMode,
	ComposeState,
	Contact,
	ConversationView,
	Draft,
	MailAddress,
	MailAttachment,
	MailClient,
	MailClientOptions,
	MailMessage,
	MailNotice,
	MailState,
	MailTransport,
	MailboxView,
	OpenConversationView,
} from 'ooxml-core/mail';

/**
 * Where the mail comes from: the built-in demo mailbox (in memory, nothing leaves the page), a JMAP
 * server (RFC 8620, RFC 8621), or a transport of your own.
 */
export type MailConnection =
	| { kind: 'demo'; seed?: DemoSeedOptions }
	| { kind: 'jmap'; url: string; auth: JmapAuth }
	| { kind: 'transport'; transport: MailTransport };

const sameSeed = (a: DemoSeedOptions = {}, b: DemoSeedOptions = {}): boolean =>
	a.now === b.now &&
	a.zone === b.zone &&
	a.bulk === b.bulk &&
	(['docx', 'xlsx', 'pptx', 'vsdx'] as const).every((kind) => a.files?.[kind] === b.files?.[kind]);

const sameAuth = (a: JmapAuth, b: JmapAuth): boolean =>
	a.type === 'bearer'
		? b.type === 'bearer' && a.token === b.token
		: b.type === 'basic' && a.username === b.username && a.password === b.password;

/**
 * Whether two connections reach the same mailbox, compared by value, so a host that writes its
 * connection inline (a new object on every render) does not reconnect each time. Credentials are
 * compared, never joined into a string. No connection at all (`null`) is the demo mailbox.
 */
export function sameMailConnection(
	a: MailConnection | null | undefined,
	b: MailConnection | null | undefined,
): boolean {
	if (a === b || (!a && !b)) return true;
	if (!a || !b) return false;
	switch (a.kind) {
		case 'demo':
			return b.kind === 'demo' && sameSeed(a.seed, b.seed);
		case 'jmap':
			return b.kind === 'jmap' && a.url === b.url && sameAuth(a.auth, b.auth);
		case 'transport':
			return b.kind === 'transport' && a.transport === b.transport;
	}
}

export interface MailOptions {
	config?: MailConnection;
	contacts?: ContactStore;
	calendar?: CalendarStore;
	/**
	 * Where the address book and the calendar are kept between visits (not in demo mode); `null`
	 * keeps them in memory only. Never used for credentials.
	 */
	storage?: KeyValueStorage | null;
	quoteFormat?: QuoteFormat;
}

/** `localStorage` when the page may use it, else nothing (private mode, sandboxed frames). */
export function browserStorage(): KeyValueStorage | null {
	try {
		const storage = globalThis.localStorage;
		const probe = '__ooxml_mail_probe__';
		storage.setItem(probe, '1');
		storage.removeItem(probe);
		return storage;
	} catch {
		return null;
	}
}

/** A storage key per account, so two servers never share an address book. */
const accountKey = (config: MailConnection): string =>
	config.kind === 'jmap' ? `jmap:${config.url.trim().toLowerCase()}` : config.kind;

/** A mail client for `options.config` (the demo mailbox by default). */
export function createMail(options: MailOptions = {}): MailClient {
	const config = options.config ?? { kind: 'demo' };
	// Only a real account keeps its address book and calendar; the demo never touches storage.
	const persisted = (name: string) => {
		const storage = options.storage === undefined ? browserStorage() : options.storage;
		return { ...(storage ? { storage } : {}), key: `ooxml-mail:${name}:${accountKey(config)}` };
	};
	let transport: MailTransport;
	let contacts = options.contacts;
	let calendar = options.calendar;
	if (config.kind === 'demo') {
		const seed = createDemoSeed(config.seed ?? {});
		transport = createMemoryTransport(seed);
		contacts ??= createMemoryContactStore({ seed: seed.contacts });
		calendar ??= createMemoryCalendarStore({ seed: seed.events });
	} else {
		transport =
			config.kind === 'jmap'
				? createJmapTransport({ url: config.url, auth: config.auth })
				: config.transport;
		contacts ??= createMemoryContactStore(persisted('contacts'));
		calendar ??= createMemoryCalendarStore(persisted('calendar'));
	}
	return createMailClient({
		transport,
		contacts,
		calendar,
		...(options.quoteFormat ? { quoteFormat: options.quoteFormat } : {}),
	});
}
