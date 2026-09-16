import { apiGet } from '../api/client'
import type { Session } from '../api/types'
import { useApp } from './store'

/** Тихое обновление сессии (счётчик уведомлений, профиль) без смены экрана. */
export async function refreshSessionQuiet() {
  const { platform, appUserId } = useApp.getState()
  try {
    const session = await apiGet<Session>(platform, `/api/session?max_user_id=${encodeURIComponent(String(appUserId))}`)
    useApp.getState().patch({ session })
  } catch {
    // фоновое обновление: ошибка не должна мешать экрану
  }
}
