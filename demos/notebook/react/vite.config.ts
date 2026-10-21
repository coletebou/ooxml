import { defineConfig } from 'vite';
// The extension stays: Vite's native config loader (a future default) resolves no others.
import { sharedConfig } from '../vite.shared.ts';

export default defineConfig({ ...sharedConfig(5302), oxc: { jsx: { runtime: 'automatic' } } });
