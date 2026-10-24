import { Component, EventEmitter } from '@angular/core';

/**
 * Stands in for `pptx-modal-dialog`: the Vitest JIT build cannot wire the modal's required signal
 * inputs, so this frame only projects the body and the footer.
 */
@Component({
	selector: 'pptx-modal-dialog',
	standalone: true,
	inputs: ['open', 'title'],
	outputs: ['close'],
	template: '<ng-content /><ng-content select="[footer]" />',
})
export class ModalFrameStub {
	open: unknown;
	title: unknown;
	close = new EventEmitter<void>();
}

/** Stands in for `pptx-dialog-footer`, whose required `actions` input the JIT build cannot wire. */
@Component({
	selector: 'pptx-dialog-footer',
	standalone: true,
	inputs: ['actions'],
	outputs: ['action'],
	template: '',
})
export class DialogFooterStub {
	actions: unknown;
	action = new EventEmitter<string>();
}
