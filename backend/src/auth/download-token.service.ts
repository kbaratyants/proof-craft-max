import crypto from 'node:crypto'
import { Injectable } from '@nestjs/common'

/** Срок жизни ссылки на скачивание: MAX забирает файл сразу после нажатия «Скачать». */
export const DOWNLOAD_TOKEN_TTL_SECONDS = 300

/** Файлы, которые можно отдать по ссылке на скачивание: фото, вложения и аватары. */
const DOWNLOADABLE_PATH = /^\/api\/[a-z0-9/_-]+\/(file|avatar)$/i

/** Путь запроса без query, приведённый к префиксу `/api`, — одинаково при выдаче и проверке. */
export const downloadPath = (url: string): string => {
  const path = url.split(/[?#]/, 1)[0] ?? ''
  return path.startsWith('/api/') ? path : `/api${path.startsWith('/') ? '' : '/'}${path}`
}

const sign = (secret: Buffer, payload: string): string =>
  crypto.createHmac('sha256', secret).update(payload).digest('base64url')

/**
 * Короткоживущая ссылка на файл для `WebApp.downloadFile`: MAX скачивает файл сам,
 * без заголовка X-Max-Init-Data, поэтому право доступа передаётся подписанным параметром `dl`.
 * Токен привязан к пользователю, пути файла и сроку; секрет живёт только в памяти процесса API.
 */
@Injectable()
export class DownloadTokenService {
  private readonly secret = crypto.randomBytes(32)

  isDownloadablePath(path: string): boolean {
    return DOWNLOADABLE_PATH.test(path) && !path.includes('..')
  }

  issue(maxUserId: number, path: string, nowMs = Date.now()): string {
    const expires = Math.floor(nowMs / 1000) + DOWNLOAD_TOKEN_TTL_SECONDS
    return `${expires}.${sign(this.secret, `${maxUserId}|${expires}|${path}`)}`
  }

  verify(token: string, maxUserId: number, path: string, nowMs = Date.now()): boolean {
    const [rawExpires, signature, extra] = token.split('.')
    if (extra !== undefined || !rawExpires || !signature) return false
    const expires = Number(rawExpires)
    if (!Number.isSafeInteger(expires) || expires < nowMs / 1000) return false
    const expected = Buffer.from(sign(this.secret, `${maxUserId}|${expires}|${path}`))
    const received = Buffer.from(signature)
    return expected.length === received.length && crypto.timingSafeEqual(expected, received)
  }
}
