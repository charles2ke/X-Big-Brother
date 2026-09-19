import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs so the same build runs from a web subpath (for example GitHub Pages) and from the native WebView.
  base: './',
  build: { target: ['es2020', 'safari15', 'chrome89'] },
  plugins: [react(), {
    name: 'development-csp',
    apply: 'serve',
    // The production policy disallows the inline preamble required by React Fast Refresh.
    transformIndexHtml: {
      order: 'pre',
      handler: html => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
    },
  }],
})
