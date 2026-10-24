<script lang="ts">
	import DialogFooter from '../../DialogFooter.svelte';
	import {
		HYPERLINK_ACTION_VERBS,
		HYPERLINK_TARGET_TYPES,
		buildClearHyperlinkPatch,
		buildHyperlinkEditPatch,
		hasHyperlinkEditTarget,
		hyperlinkEditFieldText,
		hyperlinkEditFields,
		seedHyperlinkEditDraft,
		setHyperlinkEditField,
	} from 'ooxml-ui/pptx';
	import type { HyperlinkEditFieldName, HyperlinkTargetType } from 'ooxml-ui/pptx';
	import { untrack } from 'svelte';
	import { useTranslator } from '../../../../i18n/context';
	import type { EditorState } from '../../../editor/editor-state.svelte';

	const { editor, onclose }: { editor: EditorState; onclose: () => void } = $props();
	const t = useTranslator();
	const element = $derived(editor.selectedElement ?? null);
	// The targets, each tab's fields and the patch they make are the shared model, as in every
	// binding. The dialog mounts each time it opens, so its fields are seeded once, from the
	// element it opens on.
	let draft = $state.raw(seedHyperlinkEditDraft(untrack(() => editor.selectedElement?.actionClick)));
	const fields = $derived(hyperlinkEditFields(draft.targetType));
	const showRemoveLink = $derived(hasHyperlinkEditTarget(element));

	function selectTarget(targetType: HyperlinkTargetType): void {
		draft = { ...draft, targetType };
	}

	function setField(name: HyperlinkEditFieldName, value: string): void {
		draft = setHyperlinkEditField(draft, name, value);
	}

	function save(): void {
		// The shared patch runs the URL-safety gate (blocks javascript:, data:, vbscript:, mhtml:)
		// and is `undefined` when there is nothing to apply, so a blocked address keeps the link.
		const patch = element ? buildHyperlinkEditPatch(element, draft, editor.slides.length) : undefined;
		if (element && patch) {
			editor.applyElementPatch(element.id, patch);
		}
		onclose();
	}

	function removeLink(): void {
		if (element) {
			editor.applyElementPatch(element.id, buildClearHyperlinkPatch());
		}
		onclose();
	}

	function onEnter(event: KeyboardEvent): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			save();
		}
	}
</script>

<div class="backdrop">
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
	<section role="dialog" tabindex="-1" aria-modal="true" aria-label={t('pptx.hyperlink.editTitle')}>
		<h2>{t('pptx.hyperlink.editTitle')}</h2>
		<div class="tabs">
			{#each HYPERLINK_TARGET_TYPES as tab (tab.type)}
				<button type="button" class:active={draft.targetType === tab.type} aria-pressed={draft.targetType === tab.type} onclick={() => selectTarget(tab.type)}>{t(tab.labelKey)}</button>
			{/each}
		</div>
		{#each fields as field (field.name)}
			<label>{t(field.labelKey)}
				{#if field.control === 'select'}
					<pptx-ui-select aria-label={t(field.labelKey)} value={draft.actionVerb} onchange={(event) => setField(field.name, (event.currentTarget as HTMLSelectElement).value)}>
						{#each HYPERLINK_ACTION_VERBS as opt (opt.verb)}<option value={opt.verb}>{t(opt.labelKey)}</option>{/each}
					</pptx-ui-select>
				{:else}
					<input type={field.control} aria-label={t(field.labelKey)} placeholder={field.placeholder} min={field.control === 'number' ? 1 : undefined} max={field.control === 'number' ? editor.slides.length : undefined} value={hyperlinkEditFieldText(draft, field.name)} oninput={(event) => setField(field.name, event.currentTarget.value)} onkeydown={onEnter} />
				{/if}
				{#if field.name === 'slideNumber'}<small>{t('pptx.hyperlink.slideRange', { max: editor.slides.length })}</small>{/if}
			</label>
		{/each}
		<footer><DialogFooter actions={[
			...(showRemoveLink ? [{ id: 'remove', label: t('pptx.hyperlinkDialog.removeLink'), variant: 'danger' as const, align: 'start' as const }] : []),
			{ id: 'cancel', label: t('pptx.common.cancel') },
			{ id: 'ok', label: t('pptx.common.ok'), variant: 'primary' },
		]} onaction={(id) => (id === 'remove' ? removeLink() : id === 'ok' ? save() : onclose())} /></footer>
	</section>
</div>

<style>.backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;background:#0009}section{display:grid;width:min(430px,calc(100vw - 32px));gap:13px;padding:20px;border:1px solid var(--pptx-border, var(--office-border, #d1d5db));border-radius:11px;background:var(--pptx-card, var(--office-surface, #f3f4f6))}h2{margin:0;font-size:15px}.tabs{display:flex;gap:4px;border-bottom:1px solid var(--pptx-border, var(--office-border, #d1d5db))}.tabs button{padding:6px 10px;border:0;border-bottom:2px solid transparent;background:none;color:var(--pptx-muted-foreground, var(--office-muted-foreground, #6b7280));font-size:12px;cursor:pointer}.tabs button.active{border-bottom-color:var(--pptx-primary, var(--office-accent, #2563eb));color:var(--pptx-primary, var(--office-accent, #2563eb));font-weight:500}label{display:grid;gap:5px;color:var(--pptx-muted-foreground, var(--office-muted-foreground, #6b7280));font-size:11px}small{font-size:10px}input{border:1px solid var(--pptx-border, var(--office-border, #d1d5db));border-radius:6px;padding:8px;background:var(--pptx-muted, var(--office-surface, #f3f4f6));color:inherit}footer{display:flex;justify-content:flex-end;gap:7px}</style>
