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
});
