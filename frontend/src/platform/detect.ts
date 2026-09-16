import { STORAGE_KEYS, local } from './storage'
import { getMax } from './max'

export type Platform = {
  platform: 'max' | 'standalone'
  appUserId: number | null
  webSessionToken?: string | null
}

export async function detectPlatform(): Promise<Platform> {
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
