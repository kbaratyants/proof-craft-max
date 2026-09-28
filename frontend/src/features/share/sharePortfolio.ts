import { shareLink } from '../../platform/bridge'
import { toast } from '../../ui/toast'

/** Публичная ссылка на портфолио: открывается без входа — в MAX, браузере и демо. */
export const portfolioLink = (studentId: number, homeworkId?: number) => {
  const params = new URLSearchParams({ guest: '1', student: String(studentId) })
  if (homeworkId) params.set('hw', String(homeworkId))
  return `${window.location.origin}/?${params}`
}

/** «Поделиться»: в MAX — выбор чата, в браузере — системное меню или копирование ссылки. */
export async function sharePortfolio(text: string, studentId: number, homeworkId?: number) {
  const result = await shareLink(text, portfolioLink(studentId, homeworkId))
  if (result === 'copied') toast('Ссылка скопирована', 'success')
  else if (result === 'failed') toast('Не удалось поделиться ссылкой', 'error')
}
