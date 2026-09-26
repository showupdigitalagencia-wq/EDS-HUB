import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

import { registerServiceWorker } from './registerServiceWorker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Auto-recover from stale chunks after a new deployment
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    console.warn('[PWA] Stale chunk detected after deployment, reloading fresh bundle...', event);
    window.location.reload();
  });
}

// Initialize PWA Service Worker (non-blocking)
registerServiceWorker();
