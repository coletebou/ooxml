import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Mail, type MailConnection } from 'openmail-react-viewer';
import { demoFiles } from './samples';

const params = new URLSearchParams(location.search);
const LOCALES = ['en', 'de', 'es', 'fr', 'zh-CN'];

type Theme = 'system' | 'light' | 'dark';

/**
 * The React demo: the whole app as one component on the in-memory demo mailbox. `?bulk=5000` adds
 * thousands of messages, `?locale=de` and `?theme=dark` pick the language and colours. A JMAP
 * server can be connected from the bar; the token stays in memory and is never stored.
 */
export function App() {
	const [locale, setLocale] = useState(params.get('locale') ?? '');
	const [theme, setTheme] = useState<Theme>((params.get('theme') as Theme) ?? 'system');
	const [files, setFiles] = useState<Awaited<ReturnType<typeof demoFiles>> | null>(null);
	const [jmap, setJmap] = useState<MailConnection | null>(null);
	useEffect(() => {
		void demoFiles().then(setFiles);
	}, []);
	const demo = useMemo<MailConnection | null>(
		() =>
			files && {
				kind: 'demo',
				seed: {
					files,
					bulk: Number(params.get('bulk') ?? 0) || 0,
					zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
			},
		[files],
	);
	const config = jmap ?? demo;
	return (
		<>
			<header className="demo-bar" style={bar}>
				<strong>OpenMail</strong>
				<span>
					{jmap
						? 'Connected to your JMAP server.'
						: 'Demo mailbox: everything runs in this browser and nothing is sent. Reloading resets it.'}
				</span>
				<label>
					Language{' '}
					<select value={locale} onChange={(e) => setLocale(e.target.value)}>
						<option value="">Browser</option>
						{LOCALES.map((l) => (
							<option key={l} value={l}>
								{l}
							</option>
						))}
					</select>
				</label>
				<label>
					Theme{' '}
					<select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
						<option value="system">System</option>
						<option value="light">Light</option>
						<option value="dark">Dark</option>
					</select>
				</label>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						const form = new FormData(e.currentTarget);
						const url = String(form.get('url') ?? '').trim();
						const token = String(form.get('token') ?? '');
						if (url && token) setJmap({ kind: 'jmap', url, auth: { type: 'bearer', token } });
					}}
				>
					<input name="url" type="url" placeholder="JMAP server URL" aria-label="JMAP server URL" />
					<input
						name="token"
						type="password"
						placeholder="Access token"
						aria-label="Access token"
						autoComplete="off"
					/>
					<button type="submit">Connect</button>
					{jmap && (
						<button type="button" onClick={() => setJmap(null)}>
							Back to the demo
						</button>
					)}
				</form>
			</header>
			{config ? (
				<Mail config={config} locale={locale} theme={theme} />
			) : (
				<p style={{ padding: '1em' }}>Preparing the demo mailbox...</p>
			)}
		</>
	);
}

const bar: CSSProperties = {
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '0.5em 1em',
	padding: '0.4em 1em',
	fontSize: '0.875rem',
	background: '#eef3fb',
	color: '#1b2a41',
	borderBottom: '1px solid #c9d6ea',
};
