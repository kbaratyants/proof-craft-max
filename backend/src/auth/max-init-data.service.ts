import crypto from 'node:crypto'
import { Injectable } from '@nestjs/common'

/** MAX присылает auth_date то в секундах, то в миллисекундах — приводим к секундам. */
const toSeconds = (value: number): number => (value > 1e12 ? Math.floor(value / 1000) : value)

/**
 * Проверка подписи initData мини-приложения MAX:
 * secret = HMAC-SHA256("WebAppData", botToken), hash = HMAC-SHA256(secret, отсортированные `key=value` через \n).
 */
@Injectable()
export class MaxInitDataService {
  parseAndValidate(raw: string, botToken: string, maxAgeSeconds: number): number | null {
    if (!raw || !botToken) return null

    const params = new URLSearchParams(raw)
    if (params.getAll('hash').length !== 1) return null
    const hash = params.get('hash') ?? ''

    const authDate = toSeconds(Number(params.get('auth_date')))
    if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) return null

    const keys = [...params.keys()].filter((key) => key !== 'hash').sort()
    const dataCheckString = keys.map((key) => `${key}=${params.get(key)}`).join('\n')
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
    const receivedBuffer = Buffer.from(hash, 'hex')
    const computedBuffer = Buffer.from(computed, 'hex')
    if (
      receivedBuffer.length !== computedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, computedBuffer)
    ) {
      return null
    }

    const userJson = params.get('user')
    if (!userJson) return null
    try {
      const user = JSON.parse(userJson) as { id?: unknown; user_id?: unknown }
      const maxUserId = Number(user.id ?? user.user_id)
      return maxUserId > 0 && Number.isSafeInteger(maxUserId) ? maxUserId : null
    } catch {
      return null
    }
  }
}
