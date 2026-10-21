import { defineConfig } from 'vitepress';

// Adapted from the teams viewer's docs/.vitepress/config.ts. English only for this first cut; the
// accent is the notebook's product colour (docs/pages-design.md at the repository root).
export default defineConfig({
	title: 'OpenNotebook',
	description:
		'An open-source, local-first notebook app: notebooks, sections and pages with a free-form canvas of rich text, pictures, embedded Office files and ink, with a React binding.',
	lang: 'en-US',

	// Deployed to https://christophervr.github.io/ooxml/notebook/
	base: '/ooxml/notebook/',
	cleanUrls: true,
	lastUpdated: true,
	// The demo is built into /demo/ after VitePress runs, so links to it are not pages VitePress
	// knows about.
	ignoreDeadLinks: [/^\/demo/],
	srcExclude: ['**/node_modules/**', 'README.md'],
	markdown: { theme: { light: 'vitesse-dark', dark: 'vitesse-dark' } },
	head: [
		['meta', { name: 'theme-color', content: '#7a4cc2' }],
		['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
		['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
		[
			'link',
			{
				rel: 'stylesheet',
				href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=IBM+Plex+Mono:ital,wght@0,400;0,500;1,400&display=swap',
			},
		],
		['meta', { property: 'og:type', content: 'website' }],
		['meta', { property: 'og:title', content: 'OpenNotebook documentation' }],
		[
			'meta',
			{
				property: 'og:description',
				content: 'An open-source, local-first notebook app and its React binding.',
			},
		],
	],
	themeConfig: {
		nav: [
			{
				text: 'Guide',
				link: '/getting-started',
				activeMatch: '/(getting-started|architecture|limitations|api|frameworks)',
			},
			{ text: 'Demo', link: '/demo/', target: '_self' },
			{
				text: 'OOXML Office',
				link: 'https://christophervr.github.io/ooxml/',
				target: '_self',
				rel: '',
			},
		],

		sidebar: [
			{
				text: 'Start here',
				items: [
					{ text: 'Overview', link: '/' },
					{ text: 'Getting started', link: '/getting-started' },
					{ text: 'Architecture', link: '/architecture' },
					{ text: 'Limitations', link: '/limitations' },
				],
			},
			{
				text: 'Reference',
				items: [{ text: 'Element API and events', link: '/api' }],
			},
			{
				text: 'Framework guides',
				items: [{ text: 'React', link: '/frameworks/react' }],
			},
			{
				text: 'Demo',
				// `target` keeps the VitePress router from handling it as a missing page.
				items: [{ text: 'React demo', link: '/demo/', target: '_self' }],
			},
		],

		socialLinks: [
			{ icon: 'github', link: 'https://github.com/ChristopherVR/ooxml/tree/main/viewers/notebook' },
		],

		editLink: {
			pattern: 'https://github.com/ChristopherVR/ooxml/edit/main/viewers/notebook/docs/:path',
			text: 'Edit this page on GitHub',
		},

		search: { provider: 'local' },

		footer: {
			message:
				'Released under the Apache-2.0 License. OpenNotebook is an independent project, not affiliated with any commercial notebook product.',
			copyright: 'Copyright © 2026 ChristopherVR',
		},
	},
});
