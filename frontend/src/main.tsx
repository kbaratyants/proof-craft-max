import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { STORAGE_KEYS, local } from './platform/storage'
import { initMaxChrome, loadMaxSdk } from './platform/max'
import './styles/index.css'
import './styles/overrides.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
})

async function boot() {
  try {
    await loadMaxSdk()
    // Дать SDK разобрать данные запуска из hash.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  } catch {
    // обычный браузер без MAX — допустимо
  }
  const root = document.getElementById('app')
  if (!root) throw new Error('Root element not found')
  document.documentElement.dataset.theme = local.get(STORAGE_KEYS.theme) || 'light'
  initMaxChrome()
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

boot().catch((error: unknown) => {
  console.error(error)
  const root = document.getElementById('app')
  if (root) {
    root.innerHTML = `<div style="padding:16px;font-family:sans-serif;color:#c9a227">Ошибка запуска: ${String(
      error instanceof Error ? error.message : error,
    )}</div>`
  }
})
