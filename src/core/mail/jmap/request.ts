// JMAP requests (RFC 8620 3.3 to 3.7): a builder that numbers method calls and writes result
// references as `#name` arguments, and a reader for the response that turns method-level errors
// and SetErrors into `JmapError`s. New code.
import { JmapError, methodError, setError, type Redact } from './errors';
import {
	isRecord,
	type JmapInvocation,
	type JmapRequest,
	type JmapResponse,
	type JmapSetError,
} from './types';

/** A ResultReference (RFC 8620 3.7): an argument taken from an earlier call's response. */
export class JmapResultReference {
	readonly resultOf: string;
	readonly name: string;
	readonly path: string;
	constructor(resultOf: string, name: string, path: string) {
		this.resultOf = resultOf;
		this.name = name;
		this.path = path;
	}
	toJSON(): { resultOf: string; name: string; path: string } {
		return { resultOf: this.resultOf, name: this.name, path: this.path };
	}
}

/** A method call of a request, to read its response or to refer to its result. */
export interface JmapCall {
	readonly id: string;
	readonly name: string;
	/** `path` (a JSON Pointer; `*` maps an array) of this call's response named `name`. */
	ref(path: string, name?: string): JmapResultReference;
}

/** Collects method calls into one Request object. */
export class JmapRequestBuilder {
	readonly #using: readonly string[];
	readonly #calls: JmapInvocation[] = [];

	constructor(using: readonly string[]) {
		this.#using = [...using];
	}

	/**
	 * Adds a call, by default with the id `"0"`, `"1"`, ... in order. `undefined` arguments are
	 * left out; a `JmapResultReference` argument `ids` is written as `"#ids"`.
	 */
	call(
		name: string,
		args: Readonly<Record<string, unknown>>,
		id = String(this.#calls.length),
	): JmapCall {
		const written: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(args)) {
			if (value === undefined) continue;
			if (value instanceof JmapResultReference) written[`#${key}`] = value.toJSON();
			else written[key] = value;
		}
		this.#calls.push([name, written, id]);
		return {
			id,
			name,
			ref: (path, responseName = name) => new JmapResultReference(id, responseName, path),
		};
	}

	get size(): number {
		return this.#calls.length;
	}

	build(): JmapRequest {
		return {
			using: [...this.#using],
			methodCalls: this.#calls.map(([name, args, id]): JmapInvocation => [name, args, id]),
		};
	}
}

const malformed = (what: string): JmapError =>
	new JmapError('server', `The JMAP server sent ${what}.`, { level: 'http' });

/** Checks the shape of a Response object (RFC 8620 3.4). */
export function parseJmapResponse(json: unknown): JmapResponse {
	if (!isRecord(json) || !Array.isArray(json.methodResponses))
		throw malformed('a response without methodResponses');
	const methodResponses = json.methodResponses.map((item: unknown): JmapInvocation => {
		if (
			!Array.isArray(item) ||
			typeof item[0] !== 'string' ||
			!isRecord(item[1]) ||
			typeof item[2] !== 'string'
		)
			throw malformed('a malformed method response');
		return [item[0], item[1], item[2]];
	});
	return {
		methodResponses,
		sessionState: typeof json.sessionState === 'string' ? json.sessionState : '',
	};
}

/** The /set response keys that hold SetErrors. */
export type SetErrorKey = 'notCreated' | 'notUpdated' | 'notDestroyed';
const SET_ERROR_KEYS: readonly SetErrorKey[] = ['notCreated', 'notUpdated', 'notDestroyed'];

/** The SetErrors under `key` of /set arguments, by id or creation id. */
export function setErrors(
	args: Record<string, unknown>,
	key: SetErrorKey,
): [string, JmapSetError][] {
	const map = args[key];
	if (!isRecord(map)) return [];
	return Object.entries(map).map(([id, error]) => [
		id,
		isRecord(error) && typeof error.type === 'string'
			? (error as JmapSetError)
			: { type: 'serverFail' },
	]);
}

/** The responses of one request, read call by call. */
export class JmapResult {
	readonly response: JmapResponse;
	readonly #redact: Redact;

	constructor(response: JmapResponse, redact: Redact) {
		this.response = response;
		this.#redact = redact;
	}

	/** Every response `call` produced, in order: a /set with implicit calls answers twice. */
	all(call: JmapCall): JmapInvocation[] {
		return this.response.methodResponses.filter((response) => response[2] === call.id);
	}

	/** The method-level error `call` got, or `null`. */
	error(call: JmapCall): JmapError | null {
		const first = this.all(call)[0];
		return first?.[0] === 'error' ? methodError(call.name, first[1], this.#redact) : null;
	}

	/** The arguments of `call`'s response `name` (its own name by default); throws its error. */
	get(call: JmapCall, name = call.name): Record<string, unknown> {
		const error = this.error(call);
		if (error) throw error;
		const found = this.all(call).find((response) => response[0] === name);
		if (!found)
			throw new JmapError('server', `The JMAP server sent no ${name} response.`, {
				level: 'method',
			});
		return found[1];
	}

	/** Like `get`, and throws the first SetError that `excuse` does not accept. */
	set(
		call: JmapCall,
		excuse: (type: string, key: SetErrorKey) => boolean = () => false,
		name = call.name,
	): Record<string, unknown> {
		const args = this.get(call, name);
		for (const key of SET_ERROR_KEYS)
			for (const [id, error] of setErrors(args, key))
				if (!excuse(error.type, key)) throw setError(name, id, error, this.#redact);
		return args;
	}

	/** The server id of creation `creationId` in `call`'s /set response; throws its SetError. */
	created(call: JmapCall, creationId: string, name = call.name): string {
		const args = this.get(call, name);
		const created = isRecord(args.created) ? args.created[creationId] : undefined;
		if (isRecord(created) && typeof created.id === 'string') return created.id;
		const refused = isRecord(args.notCreated) ? args.notCreated[creationId] : undefined;
		throw setError(name, creationId, refused ?? { type: 'serverFail' }, this.#redact);
	}
}

/** A PatchObject key (RFC 8620 5.3): JSON Pointer tokens with `~` and `/` escaped. */
export function patchPath(...tokens: readonly string[]): string {
	return tokens.map((token) => token.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}
