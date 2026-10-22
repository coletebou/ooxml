/** A placed rectangle: position and size in the box's units. */
export interface FittedRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Where content of `content` size goes in a `box` so it keeps its shape, as CSS `object-fit:
 * contain` draws it: as large as fits, centred. Content without a size fills the box.
 */
export function containRect(
	content: { width: number; height: number },
	box: { width: number; height: number },
): FittedRect {
	if (!(content.width > 0) || !(content.height > 0)) return { x: 0, y: 0, ...box };
	const scale = Math.min(box.width / content.width, box.height / content.height);
	const width = content.width * scale;
	const height = content.height * scale;
	return { x: (box.width - width) / 2, y: (box.height - height) / 2, width, height };
}
