import { commandFor, isTyping, SHORTCUTS } from './keyboard';

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
});
