// Tab colours for notebooks, section groups and sections. New sections take the next colour in
// turn, as notebook apps do, so neighbouring tabs differ. Names are translation keys for the UI
// (`color.<name>`); the stored value is always the `#rrggbb` string. New code.

export interface PaletteColor {
	name: string;
	value: string;
}

export const SECTION_PALETTE: readonly PaletteColor[] = [
	{ name: 'blue', value: '#8aa8e4' },
	{ name: 'yellow', value: '#f5d26b' },
	{ name: 'green', value: '#a5cf86' },
	{ name: 'red', value: '#ee9a9a' },
	{ name: 'purple', value: '#b49edc' },
	{ name: 'cyan', value: '#8fcfe0' },
	{ name: 'orange', value: '#f3ae74' },
	{ name: 'magenta', value: '#e89ccb' },
	{ name: 'teal', value: '#86cdbd' },
	{ name: 'tan', value: '#d6bc94' },
	{ name: 'lime', value: '#c9de7a' },
	{ name: 'silver', value: '#b9bec6' },
];

/** The colour for the `index`-th item of a list (cycles through the palette). */
export function paletteColor(index: number): string {
	const n = SECTION_PALETTE.length;
	const i = ((Math.floor(index) % n) + n) % n;
	return SECTION_PALETTE[i]?.value ?? '#8aa8e4';
}

/** The palette entry for a stored colour, if it is one (custom colours have none). */
export function paletteEntry(value: string): PaletteColor | undefined {
	const lower = value.toLowerCase();
	return SECTION_PALETTE.find((c) => c.value === lower);
}
