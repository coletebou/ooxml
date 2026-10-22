// `<notebook-app>`, its parts, the binding contract and the raw store live in ooxml-ui/notebook;
// this package keeps the import name the bindings and the demo use, and adds the wiring every
// binding shares (`bind.ts`).
export * from 'ooxml-ui/notebook';
export * from './bind';
