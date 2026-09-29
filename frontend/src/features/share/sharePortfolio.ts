import { apiGet } from '../../api/client'
import { guestStartParam } from '../../app/guestLink'
import { shareLink } from '../../platform/bridge'
import { isMaxMiniApp } from '../../platform/max'
import { toast } from '../../ui/toast'

let botUsername: Promise<string | null> | null = null

/** Ник бота из `/api/public/config`; запрашивается один раз, при ошибке — повторно при следующем «Поделиться». */
const fetchBotUsername = (): Promise<string | null> =>
  (botUsername ??= apiGet<{ bot_username: string | null }>({ platform: 'standalone' }, '/api/public/config')
    .then((config) => config.bot_username || null)
    .catch(() => {
      botUsername = null
      return null
    }))

/**
 * Ссылка на портфолио без входа. Внутри MAX — на мини-приложение (`max.ru/<бот>?startapp=guest_…`),
 * чтобы получатель остался в MAX; в браузере или без ника бота — на сайт.
 */
export async function portfolioLink(studentId: number, homeworkId?: number): Promise<string> {
  if (isMaxMiniApp()) {
    const bot = await fetchBotUsername()
    if (bot) return `https://max.ru/${encodeURIComponent(bot)}?startapp=${guestStartParam(studentId, homeworkId)}`
  }
  const params = new URLSearchParams({ guest: '1', student: String(studentId) })
  if (homeworkId) params.set('hw', String(homeworkId))
  return `${window.location.origin}/?${params}`
}

/** «Поделиться»: в MAX — выбор чата, в браузере — системное меню или копирование ссылки. */
export async function sharePortfolio(text: string, studentId: number, homeworkId?: number) {
  const result = await shareLink(text, await portfolioLink(studentId, homeworkId))
  if (result === 'copied') toast('Ссылка скопирована', 'success')
  else if (result === 'failed') toast('Не удалось поделиться ссылкой', 'error')
}
