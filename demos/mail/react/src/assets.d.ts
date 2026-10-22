// Vite turns a `?url` import into the public URL of the asset it bundles.
declare module '*?url' {
	const url: string;
	export default url;
}
