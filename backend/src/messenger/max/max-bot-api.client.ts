import { maxApiBaseUrl } from '../../common/max-config.js'

export type MaxUser = {
  user_id: number
  first_name?: string
  last_name?: string | null
  username?: string | null
  is_bot?: boolean
}

type MaxMessage = {
  sender?: MaxUser | null
  recipient: { chat_id: number | null; user_id?: number | null }
  body: { mid: string; text: string | null }
}

export type MaxUpdate =
  | { update_type: 'message_created'; timestamp: number; message: MaxMessage }
  | {
      update_type: 'message_callback'
      timestamp: number
      callback: { callback_id: string; payload?: string; user: MaxUser }
      message?: MaxMessage | null
    }
  | { update_type: 'bot_started'; timestamp: number; chat_id: number; user: MaxUser; payload?: string | null }
  | { update_type: string; timestamp: number }

export type MaxButton =
  | { type: 'callback'; text: string; payload: string }
  | { type: 'link'; text: string; url: string }

export type MaxAttachment =
  | { type: 'inline_keyboard'; payload: { buttons: MaxButton[][] } }
  | { type: 'image'; payload: object }
  | { type: 'video'; payload: { token: string } }

export type MaxNewMessage = { text: string; attachments?: MaxAttachment[] }
export type MaxRecipient = { chat_id: number } | { user_id: number }

export class MaxApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${status} ${code}: ${message}`)
  }
}

const ATTACHMENT_RETRIES = 4
const ATTACHMENT_RETRY_BASE_MS = 1000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Тонкий клиент MAX Bot API на fetch. Токен передаётся заголовком Authorization,
 * адрес сервера настраивается (MAX_API_BASE_URL) для тестов.
 */
export class MaxBotApiClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = maxApiBaseUrl(),
  ) {}

  async request<T>(
    httpMethod: 'GET' | 'POST',
    path: string,
    query: Record<string, string | number | undefined> = {},
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path}`)
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }
    const response = await fetch(url, {
      method: httpMethod,
      headers: {
        Authorization: this.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ?? null,
    })
    const payload = (await response.json().catch(() => ({}))) as { code?: string; message?: string }
    if (!response.ok) {
      throw new MaxApiError(response.status, payload.code || 'unknown', payload.message || response.statusText)
    }
    return payload as T
  }

  async getUpdates(
    marker: number | undefined,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<{ updates: MaxUpdate[]; marker: number | null }> {
    return await this.request(
      'GET',
      'updates',
      { marker, timeout: timeoutSeconds, types: 'message_created,message_callback,bot_started' },
      undefined,
      signal,
    )
  }

  /** Вложение, загруженное только что, может быть ещё не обработано — MAX отвечает `attachment.not.ready`. */
  async sendMessage(recipient: MaxRecipient, message: MaxNewMessage): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.request('POST', 'messages', recipient, message)
        return
      } catch (error) {
        const notReady = error instanceof MaxApiError && error.code === 'attachment.not.ready'
        if (!notReady || attempt + 1 >= ATTACHMENT_RETRIES) throw error
        await sleep(ATTACHMENT_RETRY_BASE_MS * 2 ** attempt)
      }
    }
  }

  async answerCallback(callbackId: string, notification: string): Promise<void> {
    await this.request('POST', 'answers', { callback_id: callbackId }, { notification })
  }

  /** Загрузка медиа: POST /uploads выдаёт адрес, файл уходит туда multipart-полем `data`. */
  async upload(kind: 'image' | 'video', data: Buffer, fileName: string): Promise<MaxAttachment> {
    const slot = await this.request<{ url: string; token?: string }>('POST', 'uploads', { type: kind })
    const form = new FormData()
    form.set('data', new Blob([new Uint8Array(data)]), fileName)
    const response = await fetch(slot.url, { method: 'POST', body: form })
    if (!response.ok) throw new MaxApiError(response.status, 'upload.failed', await response.text().catch(() => ''))
    if (kind === 'video') {
      if (!slot.token) throw new MaxApiError(500, 'upload.no_token', 'MAX не вернул токен видео')
      return { type: 'video', payload: { token: slot.token } }
    }
    return { type: 'image', payload: (await response.json()) as object }
  }
}
