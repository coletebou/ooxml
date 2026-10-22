// `ooxml-core/notebook`: the logic of a free-form notebook app that sits beside Word, Excel,
// PowerPoint, Visio and Teams. Notebooks hold section groups and sections, sections hold pages with
// subpages, and every page is a canvas of rich-text containers, pictures, embedded Office files and
// ink, shared through Yjs (`collab`) and kept on the device. No DOM, no UI framework, no
// ProseMirror (the editor's schema and commands are the `ooxml-core/notebook/editor` subpath).
// See docs/notebook-area.md.
export * from './archive';
export * from './canvas';
export * from './client';
export type * from './client-types';
export { fileNameOf } from './client-export';
export * from './docx-export';
export * from './ink';
export * from './model';
export * from './palette';
export * from './read';
export * from './reading-order';
export * from './registry';
export * from './rich-text';
export * from './schema';
export * from './session';
export * from './snapshot';
export * from './storage';
export * from './structure';
export * from './sync';
export * from './text-index';
export * from './views';
