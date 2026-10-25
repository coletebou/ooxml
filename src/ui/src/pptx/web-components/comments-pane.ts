import { defineCommentsPane } from '../../controls';
import { base, bridged } from './office-aliases';

/**
 * `pptx-ui-comments-pane`: the shared `office-ui-comments-pane` under the pptx token bridge, so the
 * comments pane follows the viewer theme. Every binding mounts it; see
 * `render/comments-pane-binding` for how it is driven.
 */
export function definePptxCommentsPane(registry: CustomElementRegistry): void {
	if (registry.get('pptx-ui-comments-pane')) {
		return;
	}
	registry.define(
		'pptx-ui-comments-pane',
		class extends bridged(
			base(registry, defineCommentsPane, 'office-ui-comments-pane'),
			'pptx-ui-comments-pane',
		) {},
	);
}
