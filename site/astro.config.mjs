import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://tingencreative.com',
  integrations: [react()],
  // Pages stay statically prerendered by default; only routes that opt out
  // with `export const prerender = false` (the lead-capture API) run
  // on-demand via this adapter.
  adapter: node({ mode: 'standalone' }),
  vite: {
    plugins: [tailwindcss()],
  },
});
