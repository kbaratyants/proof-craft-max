/** Минимальный контракт MAX Bridge (`window.WebApp`), который использует клиент. */
export type MaxWebApp = {
  initData?: string
  initDataUnsafe?: { user?: { id?: number } }
  platform?: string
  ready: () => void
  expand?: () => void
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void }
}

declare global {
  interface Window {
    WebApp?: MaxWebApp
  }
}

/** Не кэшировать: SDK может подгрузиться после старта модуля. */
export const getMax = (): MaxWebApp | null => window.WebApp ?? null

/** Мини-приложение действительно запущено в MAX: SDK разобрал подписанные данные запуска. */
export const isMaxMiniApp = (): boolean => Boolean(getMax()?.initData)

export function loadMaxSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.WebApp) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://st.max.ru/js/max-web-app.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Не удалось загрузить max-web-app.js'))
    document.head.appendChild(script)
  })
}

/** Только внутри MAX (есть initData); в обычном браузере ничего не делаем. */
export function initMaxChrome() {
  const max = getMax()
  if (!max?.initData) return
  try {
    max.ready()
    max.expand?.()
  } catch {
    // старая версия клиента — оформление не критично
  }
}
