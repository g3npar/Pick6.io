import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// preloads the API calls every page makes. must match the app's fetches (credentials: 'include')
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
  // same default as the app
  const api = loadEnv(mode, process.cwd()).VITE_API_URL || 'http://localhost:3001'
  return {
    plugins: [react(), earlyApiRequests(api)],
  }
})
