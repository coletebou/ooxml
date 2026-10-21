// `ooxml-core/notebook/editor`: the rich-text editor of a notebook text container without its
// view: the ProseMirror schema, commands, keymap, input rules and the y-prosemirror binding. The
// UI creates the EditorView. Kept out of `ooxml-core/notebook` so the main entry has no
// ProseMirror. New code.
export * from './commands';
export * from './input-rules';
export * from './keymap';
export * from './plugins';
export * from './schema';
