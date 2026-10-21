// The one build-time flag the demo reads. `scripts/build-pages.mjs` sets VITE_MAIL_STATIC=1 for the
// GitHub Pages build; the demo runs the in-memory demo mailbox either way and says so on the page.
interface ImportMetaEnv {
	readonly VITE_MAIL_STATIC?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
