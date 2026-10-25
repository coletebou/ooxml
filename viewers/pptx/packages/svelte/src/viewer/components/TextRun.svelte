<script lang="ts">
	/**
	 * TextRun: one rendered run of a paragraph, plus its optional `a:reflection`
	 * mirrored-sibling wrapper.
	 *
	 * The run itself (equation / hyperlink / ruby / plain span) is
	 * `TextRunBase`. Reflection is wrapped HERE, around the whole base run,
	 * rather than inside each of `TextRunBase`'s branches: a `<ruby>` run's own
	 * `display: ruby` (which positions the annotation above its base text)
	 * would break if forced to `display: inline-block` to host an absolutely
	 * positioned mirror, so the positioning box has to be an outer element that
	 * leaves the base run's own tag untouched.
	 *
	 * Cross-browser (unlike the `-webkit-box-reflect` this replaced, which
	 * Firefox never implemented): the wrapper style comes from shared's
	 * `getTextReflectionWrapperStyle`, the text-run counterpart of a
	 * shape/picture's `ShapeEffectOverlay` reflection - reused, not forked.
	 *
	 * A run a find match covers (`run.findMatch`, shared `markFindMatches`) is
	 * wrapped in a `<mark>` around the base run; the reflected copy is not marked.
	 */
	import { FIND_MATCH_STYLE } from 'ooxml-ui/pptx';
	import type { CssStyleMap, ParagraphRun } from 'ooxml-ui/pptx';

	import { styleToString } from '../style';
	import TextRunBase from './TextRunBase.svelte';
	import TextRunContent from './TextRunContent.svelte';

	const { run }: { run: ParagraphRun } = $props();
</script>

{#snippet base()}{#if run.findMatch}<mark
			data-pptx-find-match={run.findMatch}
			style={styleToString(FIND_MATCH_STYLE[run.findMatch] as CssStyleMap)}><TextRunBase {run} /></mark
		>{:else}<TextRunBase {run} />{/if}{/snippet}{#if run.reflection}<span style="position: relative; display: inline-block"
		>{@render base()}<span
			class="pptx-svelte-text-reflection"
			aria-hidden="true"
			style={styleToString(run.reflection as unknown as CssStyleMap)}
			><span style={styleToString(run.style)}><TextRunContent {run} /></span></span
		></span
	>{:else}{@render base()}{/if}
