// The presentation reading surface under its Teams tag. The element moved to the shared
// `../../preview/presentation-preview` so every product UI can show decks the same way.
import {
	definePresentationPreview,
	OfficePresentationPreview,
} from '../../preview/presentation-preview';

export class TeamsPresentationPreview extends OfficePresentationPreview {}

export function defineTeamsPresentationPreview(): void {
	definePresentationPreview('teams-presentation-preview', TeamsPresentationPreview);
}
