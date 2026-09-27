import { STORAGE_KEYS, local } from './storage'
import { getMax } from './max'

export type Platform = {
  platform: 'max' | 'standalone'
  appUserId: number | null
  webSessionToken?: string | null
}

export async function detectPlatform(): Promise<Platform> {
  // Демо-сессия жюри важнее MAX-личности: внутри мини-приложения работаем за демо-пользователя.
  const webSessionToken = local.get(STORAGE_KEYS.webSession)
  if (local.get(STORAGE_KEYS.demo) === '1' && webSessionToken) {
    return { platform: 'standalone', appUserId: null, webSessionToken }
  }
  const max = getMax()
  if (max?.initData) {
    const id = Number(max.initDataUnsafe?.user?.id || 0)
    return { platform: 'max', appUserId: id > 0 ? id : null }
  }
  return {
    platform: 'standalone',
    appUserId: null,
    webSessionToken: local.get(STORAGE_KEYS.webSession),
  }
}
