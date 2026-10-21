import { describe, expect, it, vi } from 'vitest';
import { createDemoSeed, createMemoryTransport, type MailTransport } from 'ooxml-core/mail';
import {
	bindMail,
	defineMailApp,
	pickMailProps,
	type MailApp,
	type MailConnection,
	type MailElementProps,
} from './index';

function element(): MailApp {
	defineMailApp();
	return document.createElement('mail-app') as MailApp;
}

describe('pickMailProps', () => {
	it('keeps provided values, an explicit null config, and drops undefined and handlers', () => {
		expect(
			pickMailProps({ locale: 'de', theme: undefined, config: null, className: 'a b' }),
		).toEqual({
			locale: 'de',
			config: null,
			className: 'a b',
		});
		expect(pickMailProps({ className: '' })).toEqual({});
	});
});

describe('bindMail', () => {
	it('applies props, swaps the host class list and re-applies only what changed', () => {
		const el = element();
		const binding = bindMail(el, () => ({}));
		binding.update({ theme: 'dark', view: 'calendar', className: 'one two' });
		expect(el.theme).toBe('dark');
		expect(el.view).toBe('calendar');
		expect(el.className).toBe('one two');
		el.view = 'contacts';
		binding.update({ theme: 'dark', view: 'calendar', className: 'two three' });
		expect(el.view).toBe('contacts');
		expect([...el.classList]).toEqual(['two', 'three']);
		binding.update({ theme: 'dark', view: 'calendar' });
		expect(el.classList.length).toBe(0);
		binding.destroy();
	});

	it('calls the latest handlers with (detail, event) and stops on destroy', () => {
		const el = element();
		const first = vi.fn();
		const latest = vi.fn();
		const notice = vi.fn();
		let handlers: MailElementProps = { onOpenAttachment: first };
		const binding = bindMail(el, () => handlers);
		handlers = { onOpenAttachment: latest, onNotice: notice };
		const detail = { emailId: 'e1', attachment: { name: 'a.xlsx' }, bytes: new Uint8Array() };
		const event = new CustomEvent('mail-open-attachment', { detail, cancelable: true });
		el.dispatchEvent(event);
		el.dispatchEvent(
			new CustomEvent('mail-notice', { detail: { kind: 'done', action: 'sent', count: 1 } }),
		);
		expect(first).not.toHaveBeenCalled();
		expect(latest).toHaveBeenCalledWith(detail, event);
		expect(notice).toHaveBeenCalledWith({ kind: 'done', action: 'sent', count: 1 });
		binding.destroy();
		el.dispatchEvent(new CustomEvent('mail-open-attachment', { detail }));
		expect(latest).toHaveBeenCalledOnce();
	});
});

describe('config', () => {
	it('goes back to the demo mailbox once the framework no longer passes one', async () => {
		const base = createMemoryTransport(createDemoSeed({ now: Date.UTC(2026, 9, 20) }));
		let closed = false;
		const transport: MailTransport = {
			...base,
			close() {
				closed = true;
				base.close();
			},
		};
		const el = element();
		const binding = bindMail(el, () => ({}));
		binding.update({ config: { kind: 'transport', transport } satisfies MailConnection });
		document.body.append(el);
		try {
			await el.updateComplete;
			const first = el.client;
			expect(first).not.toBeNull();
			binding.update({});
			await el.updateComplete;
			// No connection is the demo mailbox: the host's mailbox is let go.
			expect(el.config).toBeNull();
			expect(el.client).not.toBe(first);
			await vi.waitFor(() => expect(closed).toBe(true));
		} finally {
			binding.destroy();
			el.remove();
		}
	});
});

describe('locale', () => {
	it('is a shared prop: picked from the framework, applied to the element and reset when removed', () => {
		expect(pickMailProps({ locale: 'de', theme: undefined })).toEqual({ locale: 'de' });
		const el = element();
		const binding = bindMail(el, () => ({}));
		binding.update({ locale: 'de' });
		expect(el.locale).toBe('de');
		binding.update({ locale: 'zh-CN' });
		expect(el.locale).toBe('zh-CN');
		binding.update({});
		expect(el.locale).toBe('');
		binding.destroy();
	});
});
