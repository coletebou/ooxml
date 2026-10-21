// The raw, framework-neutral hook surface. Every binding wraps exactly this: create a client once,
// then read `getState()` and call its actions. Use it to build your own UI without <mail-app>.
//
//   const mail = createMail({ config: { kind: 'jmap', url: 'https://mail.example.com', auth } });
//   const stop = mail.subscribe(() => render(mail.getState()));
//   await mail.search('from:ada invoice');
import {
	ENGLISH_QUOTE_FORMAT,
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
import { draftHtml } from './compose-editor';

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
 * server (RFC 8620, RFC 8621), or a transport of your own. A transport of your own stays yours to
 * close: every client made on it leaves it open, so the next one can use it.
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
	 * Where the address book and the calendar are kept between visits (not in demo mode): the
	 * browser's local storage by default, and where the page may not use it, nowhere, each change
	 * then reported as not stored. `null` keeps them in memory only. Never used for credentials.
	 */
	storage?: KeyValueStorage | null;
	quoteFormat?: QuoteFormat;
}

/**
 * Whether a client made for `a` serves `b` as well: the same connection, compared by value as
 * `sameMailConnection` does, and the same address book, calendar and storage objects. A raw hook
 * makes a new client only when this is false. The quote wording is not compared: a hook hands it
 * on through `followQuoteFormat`, which needs no new client.
 */
export function sameMailOptions(
	a: MailOptions | null | undefined,
	b: MailOptions | null | undefined,
): boolean {
	if (!a || !b) return !a === !b;
	return (
		sameMailConnection(a.config, b.config) &&
		a.contacts === b.contacts &&
		a.calendar === b.calendar &&
		a.storage === b.storage
	);
}

/**
 * Quote wording that is `current()` each time a reply or forward starts (English when there is
 * none), for a raw hook to give `createMail` so that wording a host changes is used from then on.
 */
export function followQuoteFormat(current: () => QuoteFormat | undefined): QuoteFormat {
	const format = (): QuoteFormat => current() ?? ENGLISH_QUOTE_FORMAT;
	return {
		attribution: (source) => format().attribution(source),
		forwardHeader: (source) => format().forwardHeader(source),
	};
}

/**
 * `localStorage` when the page may use it, else nothing (storage turned off, sandboxed frames). It
 * is read to find out, never written: a full storage still holds the address book and the
 * calendar, and their stores report each write it refuses.
 */
export function browserStorage(): KeyValueStorage | null {
	try {
		const storage = globalThis.localStorage;
		storage.getItem('__ooxml_mail_probe__');
		return storage;
	} catch {
		return null;
	}
}

/** Where the page may not use the browser's storage: every write refused, so each change says so. */
const NOWHERE: KeyValueStorage = {
	getItem: () => null,
	setItem: () => {
		throw new Error('The page may not use the browser storage.');
	},
};

/** A storage key per account, so two servers never share an address book. */
const accountKey = (config: MailConnection): string =>
	config.kind === 'jmap' ? `jmap:${config.url.trim().toLowerCase()}` : config.kind;

/**
 * A mail client for `options.config` (the demo mailbox by default). Destroying it closes the
 * transport it made (the demo mailbox, a JMAP connection), never a transport of your own.
 */
export function createMail(options: MailOptions = {}): MailClient {
	const config = options.config ?? { kind: 'demo' };
	// Only a real account keeps its address book and calendar; the demo never touches storage.
	const persisted = (name: string) => {
		const storage = options.storage === undefined ? (browserStorage() ?? NOWHERE) : options.storage;
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
		// The host's transport may outlive this client: a remounted app or a hook makes another on it.
		closeTransport: config.kind !== 'transport',
		contacts,
		calendar,
		// Answers, forwards and reopened drafts start with every part of an HTML body, cleaned.
		draftHtml,
		...(options.quoteFormat ? { quoteFormat: options.quoteFormat } : {}),
	});
}
