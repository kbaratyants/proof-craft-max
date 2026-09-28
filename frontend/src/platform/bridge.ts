import { getMax } from './max'

/**
 * Возможности MAX Bridge с запасным вариантом для обычного браузера (в том числе демо на сайте):
 * вне MAX вибрация идёт через `navigator.vibrate`, «Поделиться» — через системное меню или буфер обмена,
 * подтверждение закрытия — через `beforeunload`.
 */

/** Внутри MAX: SDK загружен и мини-приложение получило данные запуска. */
const bridge = () => {
  const max = getMax()
  return max?.initData ? max : null
}

const vibrate = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // браузер без Vibration API
  }
}

const call = (fn: () => void) => {
  try {
    fn()
  } catch {
    // старый клиент MAX без метода — отклик не критичен
  }
}

export type HapticKind = 'success' | 'error' | 'warning'

export const haptic = {
  /** Выбор: вкладка, звезда оценки, фильтр. */
  select() {
    const hf = bridge()?.HapticFeedback
    if (hf) call(() => hf.selectionChanged())
    else vibrate(8)
  },
  /** Лёгкий удар: отправка сообщения. */
  tap() {
    const hf = bridge()?.HapticFeedback
    if (hf) call(() => hf.impactOccurred('light'))
    else vibrate(12)
  },
  /** Итог действия: успех, ошибка или предупреждение (новое событие, не заполнено поле). */
  notify(kind: HapticKind) {
    const hf = bridge()?.HapticFeedback
    if (hf) call(() => hf.notificationOccurred(kind))
    else vibrate(kind === 'success' ? [15, 60, 25] : kind === 'error' ? [40, 50, 40, 50, 40] : [30, 80, 30])
  },
}

export type ShareResult = 'shared' | 'copied' | 'failed'

/** Поделиться ссылкой: в MAX — выбор чата, в браузере — системное меню или копирование. */
export async function shareLink(text: string, link: string): Promise<ShareResult> {
  const max = bridge()
  if (max?.shareMaxContent) {
    call(() => max.shareMaxContent?.({ text, link }))
    return 'shared'
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, url: link })
      return 'shared'
    } catch (error) {
      // Пользователь закрыл меню — это не ошибка.
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared'
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${link}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** Клиент MAX умеет сохранять файлы сам. */
export const canDownloadInMax = (): boolean => Boolean(bridge()?.downloadFile)

/** Скачивание средствами MAX: ссылка должна открываться без заголовков авторизации. */
export function downloadInMax(url: string, fileName: string) {
  const max = bridge()
  if (max?.downloadFile) call(() => max.downloadFile?.(url, fileName))
}

/** Сколько экранов сейчас держат несохранённые данные: подтверждение нужно, пока их больше нуля. */
let guards = 0

const onBeforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault()
  event.returnValue = ''
}

const syncClosingConfirmation = () => {
  const max = bridge()
  if (max) {
    call(() => (guards > 0 ? max.enableClosingConfirmation?.() : max.disableClosingConfirmation?.()))
    return
  }
  window.removeEventListener('beforeunload', onBeforeUnload)
  if (guards > 0) window.addEventListener('beforeunload', onBeforeUnload)
}

/** Включает «Закрыть приложение?» до вызова возвращённой функции. */
export function holdClosingConfirmation(): () => void {
  guards += 1
  syncClosingConfirmation()
  let released = false
  return () => {
    if (released) return
    released = true
    guards -= 1
    syncClosingConfirmation()
  }
}
