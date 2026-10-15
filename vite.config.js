import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// starts the connection to the API and the two requests every page makes while
// the JavaScript is still downloading, instead of after it runs. the app's own
// fetches for these reuse the preloaded responses, so they need the same
// credentials (`credentials: 'include'` there, `use-credentials` here)
function earlyApiRequests(api) {
  return {
    name: 'early-api-requests',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'preconnect', href: api, crossorigin: 'use-credentials' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'preload', as: 'fetch', href: `${api}/puzzle/today/current`, crossorigin: 'use-credentials' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'preload', as: 'fetch', href: `${api}/auth/me`, crossorigin: 'use-credentials' }, injectTo: 'head' },
    ],
  }
}

export default defineConfig(({ mode }) => {
  // same default as the app uses when VITE_API_URL isn't set
  const api = loadEnv(mode, process.cwd()).VITE_API_URL || 'http://localhost:3001'
  return {
    plugins: [react(), earlyApiRequests(api)],
  }
})
