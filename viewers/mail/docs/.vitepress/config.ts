import { defineConfig } from 'vitepress';

// The documentation of OpenMail, deployed to https://christophervr.github.io/ooxml/mail/. A neutral
// blue accent: OpenMail is not affiliated with any mail provider and borrows no brand.
export default defineConfig({
	title: 'OpenMail',
	description:
		'An open-source mail, calendar and contacts app that speaks JMAP, with a web component and a React binding.',
	lang: 'en-US',
	base: '/ooxml/mail/',
	cleanUrls: true,
	lastUpdated: true,
	// The demo is built into /demo-react/ after VitePress runs, so links to it are not pages.
	ignoreDeadLinks: [/^\/demo/],
	srcExclude: ['**/node_modules/**', 'README.md'],
	head: [['meta', { name: 'theme-color', content: '#1f6feb' }]],
	themeConfig: {
		nav: [
			{
				text: 'Guide',
				link: '/getting-started',
				activeMatch: '/(getting-started|jmap|architecture|limitations)',
			},
			{ text: 'Live demo', link: '/demo-react/', target: '_self', rel: '' },
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
					{ text: 'Connect a JMAP server', link: '/jmap' },
					{ text: 'Architecture', link: '/architecture' },
					{ text: 'Limitations', link: '/limitations' },
				],
			},
		],
		socialLinks: [
			{ icon: 'github', link: 'https://github.com/ChristopherVR/ooxml/tree/main/viewers/mail' },
		],
		footer: { message: 'Apache-2.0. Not affiliated with any mail provider.' },
	},
});
