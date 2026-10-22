// Autoformat while typing at the start of a line: `* `, `- ` or `+ ` start bullets, `1. ` starts
// numbering (at that number), `# ` to `### ` make headings, and `[] ` or `[x] ` add a to-do tag.
// DOM-free. New code.
import { InputRule, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { notebookSchema as schema } from './schema';

const todoRule = new InputRule(/^\[( |x|X)?\]\s$/u, (state, match, start, end) => {
	const { $from } = state.selection;
	const parent = $from.parent;
	if (!parent.isTextblock || !('todo' in parent.attrs)) return null;
	const done = !!match[1] && match[1].toLowerCase() === 'x';
	return state.tr
		.delete(start, end)
		.setNodeMarkup($from.before(), undefined, { ...parent.attrs, todo: done ? 'done' : 'open' });
});

export const notebookInputRules: InputRule[] = [
	wrappingInputRule(/^\s*([-+*])\s$/u, schema.nodes.bullet_list!),
	wrappingInputRule(
		/^(\d+)\.\s$/u,
		schema.nodes.ordered_list!,
		(match) => ({ order: Number(match[1]) }),
		(match, node) => node.childCount + Number(node.attrs.order) === Number(match[1]),
	),
	textblockTypeInputRule(/^(#{1,3})\s$/u, schema.nodes.heading!, (match) => ({
		level: match[1]?.length ?? 1,
	})),
	todoRule,
];
