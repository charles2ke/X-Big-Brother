import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
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
