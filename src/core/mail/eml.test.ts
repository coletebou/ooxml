import { readFileSync } from 'node:fs';
import { emlFileName, exportEml, importEml, isEmlFile } from './eml';

describe('isEmlFile', () => {
	it('recognises .eml names and message types', () => {
		expect(isEmlFile('Planning.eml')).toBe(true);
		expect(isEmlFile(' SAVED.EML ')).toBe(true);
		expect(isEmlFile('notes', 'message/rfc822')).toBe(true);
		expect(isEmlFile('notes', 'Message/Global; charset=utf-8')).toBe(true);
		expect(isEmlFile('report.pdf', 'application/pdf')).toBe(false);
		expect(isEmlFile('mail.emlx')).toBe(false);
		expect(isEmlFile('eml')).toBe(false);
	});
});

describe('emlFileName', () => {
	it('names an exported message after its subject', () => {
		expect(emlFileName('Re: Q3 plan')).toBe('Re Q3 plan.eml');
		expect(emlFileName('')).toBe('message.eml');
	});
});

describe('importEml and exportEml', () => {
	it('read a saved message and write one that reads back the same', () => {
		const imported = importEml(
			readFileSync(new URL('./__fixtures__/related-cid.eml', import.meta.url)),
		);
		expect(imported.subject).toBe('Our new logo');
		const exported = exportEml({
			from: imported.from[0]!,
			to: imported.to,
			subject: imported.subject,
			text: imported.text ?? '',
			html: imported.html ?? '',
			attachments: imported.attachments.map(({ name, type, bytes, cid }) => ({
				name,
				type,
				bytes,
				...(cid ? { cid } : {}),
			})),
			messageId: imported.messageId[0]!,
			date: imported.sentAt!,
		});
		const again = importEml(exported);
		expect(again.subject).toBe(imported.subject);
		expect(again.text).toBe(imported.text);
		expect(again.html).toBe(imported.html);
		expect(again.messageId).toEqual(imported.messageId);
		expect(again.sentAt).toBe(imported.sentAt);
		expect(
			again.attachments.map(({ name, type, cid, bytes }) => ({ name, type, cid, bytes })),
		).toEqual(
			imported.attachments.map(({ name, type, cid, bytes }) => ({ name, type, cid, bytes })),
		);
	});
});
