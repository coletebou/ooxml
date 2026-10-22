// Keyboard helpers shared by the app's fields. DOM-free.

/** Enter that confirms an IME candidate (Chinese, Japanese) belongs to the input method. */
export const composing = (event: KeyboardEvent): boolean =>
	event.isComposing || event.keyCode === 229;
