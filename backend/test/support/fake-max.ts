import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export type RecordedCall = { method: string; query: Record<string, string>; body: Record<string, unknown> }
export type MaxPerson = { id: number; username?: string; first_name: string; last_name?: string }
type Button = { type: string; text: string; payload?: string; url?: string; web_app?: string }

/** Диалог бота с пользователем в MAX имеет свой chat_id, отличный от user_id. */
export const chatOf = (userId: number): number => userId + 500_000

/**
 * Поддельный MAX Bot API для тестов бота: отдаёт обновления через GET /updates и записывает
 * всё, что отправляет бот (POST /messages, /answers, загрузки медиа).
 */
export class FakeMax {
  readonly calls: RecordedCall[] = []
  private server: Server | null = null
  private baseUrl = ''
  private updates: Array<{ seq: number; update: object }> = []
  private nextSeq = 1
  private waiting: Array<() => void> = []
  private delivered: Array<{ seq: number; resolve: () => void }> = []

  constructor(private readonly token: string) {}

  async start(): Promise<string> {
    this.server = createServer((request, response) => void this.handle(request, response))
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', resolve))
    this.baseUrl = `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`
    return this.baseUrl
  }

  async stop(): Promise<void> {
    this.waiting.forEach((wake) => wake())
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve())
  }

  private async readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks)
    const type = String(request.headers['content-type'] || '')
    if (type.startsWith('multipart/form-data')) {
      const form = await new Response(raw, { headers: { 'content-type': type } }).formData()
      const body: Record<string, unknown> = {}
      for (const [key, value] of form.entries()) {
        body[key] = typeof value === 'string' ? value : { uploadedFile: value.name, size: value.size }
      }
      return body
    }
    return raw.length ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : {}
  }

  private json(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(String(request.url), 'http://fake')
    const method = url.pathname.replace(/^\/+/, '')
    const query = Object.fromEntries(url.searchParams)
    const body = await this.readBody(request)

    if (method.startsWith('upload/')) {
      this.calls.push({ method, query, body })
      if (method === 'upload/image') this.json(response, 200, { photos: { p1: { token: 'photo-token' } } })
      else response.end('<retval>1</retval>')
      return
    }
    if (request.headers.authorization !== this.token) {
      this.json(response, 401, { code: 'verify.token', message: 'Invalid access_token' })
      return
    }
    if (method === 'updates') {
      const marker = Number(query.marker ?? 0)
      // Бот обрабатывает обновления последовательно: новый запрос с marker значит, что предыдущие обработаны.
      this.delivered = this.delivered.filter((d) => (d.seq <= marker ? (d.resolve(), false) : true))
      this.updates = this.updates.filter((u) => u.seq > marker)
      if (!this.updates.length) {
        await new Promise<void>((resolve) => {
          this.waiting.push(resolve)
          setTimeout(resolve, 200)
        })
      }
      const batch = [...this.updates]
      this.json(response, 200, { updates: batch.map((u) => u.update), marker: batch.at(-1)?.seq ?? (marker || null) })
      return
    }
    this.calls.push({ method, query, body })
    if (method === 'uploads') {
      this.json(response, 200, query.type === 'video'
        ? { url: `${this.baseUrl}/upload/video`, token: 'video-token' }
        : { url: `${this.baseUrl}/upload/image` })
      return
    }
    if (method === 'answers') {
      this.json(response, 200, { success: true })
      return
    }
    this.json(response, 200, { message: { body: { mid: `mid-${this.calls.length}`, text: body.text ?? null } } })
  }

  private push(update: Record<string, unknown>): Promise<void> {
    const seq = this.nextSeq++
    this.updates.push({ seq, update: { timestamp: Date.now(), ...update } })
    this.waiting.splice(0).forEach((wake) => wake())
    return new Promise((resolve) => this.delivered.push({ seq, resolve }))
  }

  private user(person: MaxPerson) {
    return { user_id: person.id, first_name: person.first_name, last_name: person.last_name ?? null, username: person.username ?? null, is_bot: false }
  }

  /** Текстовое сообщение пользователя; промис завершается, когда бот его обработал. */
  message(from: MaxPerson, text: string): Promise<void> {
    return this.push({
      update_type: 'message_created',
      message: { sender: this.user(from), recipient: { chat_id: chatOf(from.id), chat_type: 'dialog' }, body: { mid: `in-${this.nextSeq}`, text } },
    })
  }

  /** Запуск бота, в том числе по ссылке `?start=<payload>`. */
  started(from: MaxPerson, payload: string | null): Promise<void> {
    return this.push({ update_type: 'bot_started', chat_id: chatOf(from.id), user: this.user(from), payload })
  }

  /** Нажатие inline-кнопки. */
  press(from: MaxPerson, payload: string): Promise<void> {
    return this.push({
      update_type: 'message_callback',
      callback: { callback_id: `cb-${this.nextSeq}`, payload, user: this.user(from), timestamp: Date.now() },
      message: { recipient: { chat_id: chatOf(from.id), chat_type: 'dialog' }, body: { mid: 'bot-message', text: '' } },
    })
  }

  /** Вызовы, сделанные после отметки `since`. */
  after(since: number): RecordedCall[] {
    return this.calls.slice(since)
  }

  /** Отправленные сообщения; `userId` оставляет адресованные пользователю лично или в его диалог. */
  sent(since: number, userId?: number): RecordedCall[] {
    return this.after(since).filter(
      (c) =>
        c.method === 'messages' &&
        (userId == null || Number(c.query.user_id) === userId || Number(c.query.chat_id) === chatOf(userId)),
    )
  }

  texts(since: number, userId?: number): string[] {
    return this.sent(since, userId).map((c) => String(c.body.text ?? ''))
  }
}

export const buttonsOf = (call: RecordedCall | undefined): Button[] => {
  const attachments = (call?.body.attachments ?? []) as Array<{ type: string; payload: { buttons?: Button[][] } }>
  return attachments.find((a) => a.type === 'inline_keyboard')?.payload.buttons?.flat() ?? []
}
