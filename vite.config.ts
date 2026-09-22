import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/** Vite's type is `true | string[]` (no `false`), so the parsed value is annotated, not inferred. */
const EXTRA_ALLOWED_HOSTS: true | string[] | undefined = (() => {
  const raw = process.env.VITE_ALLOWED_HOSTS;
  if (!raw) return undefined;                       // unset -> Vite's own default (localhost only)
  if (raw === '*') return true;
  const list = raw.split(',').map((h) => h.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
})();

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Vite 6 rejects unknown Host headers on the dev server (DNS-rebinding hardening), which also
      // rejects every tunnelled or proxied preview - the request dies with "host not allowed" before
      // Express ever sees it. Off by default; set VITE_ALLOWED_HOSTS to the extra hosts (a leading dot
      // matches subdomains) or '*' for a throwaway sandbox.
      allowedHosts: EXTRA_ALLOWED_HOSTS,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
