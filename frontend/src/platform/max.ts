/** Минимальный контракт MAX Bridge (`window.WebApp`), который использует клиент. */
export type MaxWebApp = {
  initData?: string
  initDataUnsafe?: { user?: { id?: number; first_name?: string; last_name?: string }; start_param?: string }
  /** Окно MAX с запросом номера телефона; при отказе промис отклоняется. */
  requestContact?: () => Promise<{ phone?: string } & Record<string, unknown>>
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

/** Параметр запуска мини-приложения (кнопка бота open_app с payload или ссылка ?startapp=…). */
export function getStartParam(): string | null {
  const max = getMax()
  const direct = max?.initDataUnsafe?.start_param
  if (direct) return direct
  try {
    return new URLSearchParams(max?.initData || '').get('start_param')
  } catch {
    return null
  }
}

/** Имя и фамилия из профиля MAX (данные запуска мини-приложения). */
export function maxProfileName(): { firstName: string; lastName: string } | null {
  const user = getMax()?.initDataUnsafe?.user
  if (!user?.first_name && !user?.last_name) return null
  return { firstName: String(user.first_name || '').trim(), lastName: String(user.last_name || '').trim() }
}

/** Телефон пользователя через MAX Bridge: `+7…` или null, если пользователь отказал. */
export async function requestMaxPhone(): Promise<string | null> {
  const max = getMax()
  if (!max?.requestContact) return null
  try {
    const result = await max.requestContact()
    const digits = String(result?.phone || '').replace(/\D/g, '')
    return digits ? `+${digits}` : null
  } catch {
    return null
  }
}
