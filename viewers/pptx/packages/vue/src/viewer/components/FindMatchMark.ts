import { FIND_MATCH_STYLE } from 'ooxml-ui/pptx';
import type { FindMatchKind } from 'ooxml-ui/pptx';
import type { FunctionalComponent } from 'vue';
import { h } from 'vue';

/**
 * The `<mark>` around a run a find match covers, styled by shared's
 * `FIND_MATCH_STYLE` and tagged `data-pptx-find-match` with its kind; without a
 * kind it renders its content alone, adding no element.
 */
const FindMatchMark: FunctionalComponent<{ kind?: FindMatchKind | undefined }> = (
	props,
	{ slots },
) =>
	props.kind
		? h(
				'mark',
				{ 'data-pptx-find-match': props.kind, style: FIND_MATCH_STYLE[props.kind] },
				slots.default?.(),
			)
		: slots.default?.();

FindMatchMark.props = ['kind'];

export default FindMatchMark;
