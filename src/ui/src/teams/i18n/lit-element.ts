// Base of the Teams app elements that are plain Lit elements (the app, its dialogs and panes): the
// shared locale-inheriting Lit element plus the Teams translator. `TeamsElement` (../base) is the
// same contract over `OfficeElement`.
import type { MessageParams } from 'ooxml-core/i18n';
import { LocaleLitElement } from '../../i18n/locale-element';
import { teamsI18n, type TeamsI18n, type TeamsKey, type TeamsPluralKey } from './translator';

export class TeamsLitElement extends LocaleLitElement {
	protected get i18n(): TeamsI18n {
		return teamsI18n(this.locale);
	}
	protected t(key: TeamsKey, params?: MessageParams): string {
		return this.i18n.t(key, params);
	}
	protected tn(key: TeamsPluralKey, count: number, params?: MessageParams): string {
		return this.i18n.tn(key, count, params);
	}
}
