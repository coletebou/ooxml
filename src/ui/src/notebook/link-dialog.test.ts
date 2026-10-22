import { defineDialog } from '../dialog/dialog';
import { type NotebookLinkDialog, defineNotebookLinkDialog } from './link-dialog';

describe('<notebook-link-dialog>', () => {
	it('shows the address it is opened with, not what was typed into it last time', async () => {
		defineDialog();
		defineNotebookLinkDialog();
		const dialog = document.createElement('notebook-link-dialog') as NotebookLinkDialog;
		document.body.append(dialog);
		const field = () => dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="href"]')!;
		dialog.value = { href: '', text: '', linked: false };
		await dialog.updateComplete;
		field().value = 'https://typed.example/';
		dialog.value = null;
		await dialog.updateComplete;
		dialog.value = { href: '', text: '', linked: false };
		await dialog.updateComplete;
		expect(field().value).toBe('');
		dialog.remove();
	});

	it('keeps what was typed when the address is refused', async () => {
		defineDialog();
		defineNotebookLinkDialog();
		const dialog = document.createElement('notebook-link-dialog') as NotebookLinkDialog;
		document.body.append(dialog);
		dialog.value = { href: '', text: 'label', linked: false };
		await dialog.updateComplete;
		const field = dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="href"]')!;
		field.value = 'not a link';
		field.dispatchEvent(new Event('input'));
		field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await dialog.updateComplete;
		expect(dialog.shadowRoot!.querySelector('.error')).not.toBeNull();
		expect(field.value).toBe('not a link');
		dialog.remove();
	});
});
