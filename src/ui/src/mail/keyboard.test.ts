import { commandFor, controlOwnsKey, isCancelKey, isTyping, SHORTCUTS } from './keyboard';

describe('mail shortcuts', () => {
	it('maps plain keys outside text fields', () => {
		expect(commandFor({ key: 'c' }, false)).toBe('compose');
		expect(commandFor({ key: 'j' }, false)).toBe('next');
		expect(commandFor({ key: 'ArrowUp' }, false)).toBe('previous');
		expect(commandFor({ key: '#' }, false)).toBe('delete');
		expect(commandFor({ key: 'U', shiftKey: true }, false)).toBe('markUnread');
		expect(commandFor({ key: 'I', shiftKey: true }, false)).toBe('markRead');
		expect(commandFor({ key: 'a', ctrlKey: true }, false)).toBe('selectAll');
		expect(commandFor({ key: 'q' }, false)).toBeNull();
	});
	it('only Escape and the send chord work while typing', () => {
		expect(commandFor({ key: 'c' }, true)).toBeNull();
		expect(commandFor({ key: 'Escape' }, true)).toBe('close');
		expect(commandFor({ key: 'Enter', metaKey: true }, true)).toBe('send');
		expect(commandFor({ key: 'e', altKey: true }, false)).toBeNull();
	});
	it('leaves every key to an input method while it composes, Escape too', () => {
		// Chrome on macOS gives the Escape that cancels a candidate list as a composing key.
		for (const typing of [true, false]) {
			expect(commandFor({ key: 'Escape', isComposing: true }, typing)).toBeNull();
			expect(commandFor({ key: 'Enter', ctrlKey: true, isComposing: true }, typing)).toBeNull();
		}
		expect(commandFor({ key: 'c', isComposing: true }, false)).toBeNull();
		expect(
			[{ key: 'Escape' }, { key: 'Escape', isComposing: true }, { key: 'Enter' }].map(isCancelKey),
		).toEqual([true, false, false]);
	});
	it('lists every command once for the help dialog', () => {
		const commands = SHORTCUTS.map((s) => s.command);
		expect(new Set(commands).size).toBe(commands.length);
	});
	it('knows text fields', () => {
		const input = document.createElement('input');
		const div = document.createElement('div');
		div.setAttribute('contenteditable', 'true');
		expect(isTyping([input])).toBe(true);
		expect(isTyping([div])).toBe(true);
		expect(isTyping([document.createElement('button')])).toBe(false);
	});
	it('counts only the fields text is typed in, so a checkbox keeps the shortcuts', () => {
		const input = (type: string): HTMLInputElement =>
			Object.assign(document.createElement('input'), { type });
		for (const type of ['text', 'search', 'email', 'number', 'date', 'password', 'unknown'])
			expect(isTyping([input(type)]), type).toBe(true);
		for (const type of ['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'])
			expect(isTyping([input(type)]), type).toBe(false);
		// A selection checkbox: a letter is the app's, Space and Enter stay the checkbox's.
		const box = input('checkbox');
		expect(commandFor({ key: 'e' }, isTyping([box]))).toBe('archive');
		expect(controlOwnsKey({ key: ' ' }, [box])).toBe(true);
		expect(controlOwnsKey({ key: 'Enter' }, [box])).toBe(true);
	});
	it('leaves the keys a focused control acts on to it', () => {
		const el = (tag: string, role?: string): HTMLElement => {
			const made = document.createElement(tag);
			if (role) made.setAttribute('role', role);
			return made;
		};
		expect(controlOwnsKey({ key: 'Enter' }, [el('button')])).toBe(true);
		expect(controlOwnsKey({ key: 'Enter' }, [el('a')])).toBe(true);
		expect(controlOwnsKey({ key: ' ' }, [el('summary')])).toBe(true);
		expect(controlOwnsKey({ key: 'ArrowDown' }, [el('div', 'tab')])).toBe(true);
		expect(controlOwnsKey({ key: 'ArrowUp' }, [el('select')])).toBe(true);
		// Shortcut letters and the send chord still work on a button; a list box (the message list)
		// keeps the focus itself and leaves Enter to the app.
		expect(controlOwnsKey({ key: 'j' }, [el('button')])).toBe(false);
		expect(controlOwnsKey({ key: 'Enter', ctrlKey: true }, [el('button')])).toBe(false);
		expect(controlOwnsKey({ key: 'Enter' }, [el('div', 'listbox')])).toBe(false);
		expect(controlOwnsKey({ key: 'Enter' }, [el('div')])).toBe(false);
	});
});
