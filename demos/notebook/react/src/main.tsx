import { createRoot } from 'react-dom/client';
import { App, forcedTheme } from './App';

// A forced ?theme= also colours the page around the app; otherwise the page follows the docs
// site's appearance choice (or the operating system), and so does the app.
if (forcedTheme) document.documentElement.setAttribute('data-office-theme', forcedTheme);
else await import('../../theme-sync');

createRoot(document.getElementById('root')!).render(<App />);
