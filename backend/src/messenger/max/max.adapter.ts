import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import { FileReferenceService } from '../../storage/file-reference.service.js'
import { botCommands } from '../bot-commands.js'
import { BotRouter } from '../bot.router.js'
import type { ChannelPort, ChannelUser, IncomingEvent, OutgoingMessage } from '../channel.types.js'
import { keyboard } from './max-keyboard.js'
import {
  MaxBotApiClient,
  type MaxAttachment,
  type MaxNewMessage,
  type MaxRecipient,
  type MaxUpdate,
  type MaxUser,
} from './max-bot-api.client.js'

const channelUser = (user: MaxUser): ChannelUser => ({
  channel: 'max',
  externalId: user.user_id,
  username: user.username ?? null,
  firstName: user.first_name ?? null,
  lastName: user.last_name ?? null,
})

const COMMAND = /^\/([a-z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/i

/** Обновление MAX → событие ядра бота. Запуск по ссылке `?start=<payload>` приходит как `bot_started`. */
export const toIncomingEvent = (update: MaxUpdate): IncomingEvent | null => {
  if (update.update_type === 'bot_started' && 'user' in update) {
    return { kind: 'command', user: channelUser(update.user), chatId: update.chat_id, command: 'start', args: update.payload ?? '' }
  }
  if (update.update_type === 'message_callback' && 'callback' in update) {
    const chatId = update.message?.recipient.chat_id
    if (!update.callback.payload || chatId == null) return null
    return {
      kind: 'button',
      user: channelUser(update.callback.user),
      chatId,
      data: update.callback.payload,
      callbackId: update.callback.callback_id,
    }
  }
  if (update.update_type === 'message_created' && 'message' in update) {
    const { sender, recipient, body } = update.message
    if (!sender || sender.is_bot || recipient.chat_id == null) return null
    const user = channelUser(sender)
    const command = COMMAND.exec(body.text ?? '')
    if (command) {
      return { kind: 'command', user, chatId: recipient.chat_id, command: (command[1] ?? '').toLowerCase(), args: command[2] ?? '' }
    }
    return { kind: 'message', user, chatId: recipient.chat_id, text: body.text ?? null }
  }
  return null
}

/**
 * MAX-адаптер: long polling /updates, последовательная обработка обновлений
 * и отправка ответов с inline-кнопками и медиа из хранилища.
 */
@Injectable()
export class MaxAdapter implements ChannelPort, OnApplicationShutdown {
  readonly kind = 'max' as const
  private readonly logger = new Logger(MaxAdapter.name)
  private client: MaxBotApiClient | null = null
  private running = false
  private abort: AbortController | null = null
  private loop: Promise<void> | null = null

  constructor(
    @Inject(BotRouter) private readonly router: BotRouter,
    @Inject(FileReferenceService) private readonly files: FileReferenceService,
  ) {}

  start(token: string): void {
    this.client = new MaxBotApiClient(token)
    this.running = true
    this.client.setCommands(botCommands()).catch((error: unknown) => {
      this.logger.warn(`Не удалось обновить меню команд: ${error instanceof Error ? error.message : String(error)}`)
    })
    this.loop = this.poll()
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false
    this.abort?.abort()
    await this.loop?.catch(() => {})
  }

  private async poll(): Promise<void> {
    let marker: number | undefined
    const timeout = Number(process.env.MAX_POLL_TIMEOUT_SEC ?? 30)
    while (this.running) {
      this.abort = new AbortController()
      try {
        const result = await this.client!.getUpdates(marker, timeout, this.abort.signal)
        if (result.marker != null) marker = result.marker
        for (const update of result.updates) {
          const event = toIncomingEvent(update)
          if (event) await this.router.handle(this, event)
        }
      } catch (error) {
        if (!this.running) return
        this.logger.warn(`/updates: ${error instanceof Error ? error.message : String(error)}`)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }

  async send(chatId: number, message: OutgoingMessage): Promise<void> {
    await this.deliver({ chat_id: chatId }, message)
  }

  async sendToUser(userId: number, message: OutgoingMessage): Promise<void> {
    await this.deliver({ user_id: userId }, message)
  }

  /**
   * Всплывающее уведомление к нажатию. Если MAX его не принял, текст не теряется —
   * уходит обычным сообщением в тот же чат.
   */
  async answerButton(chatId: number, callbackId: string, text?: string): Promise<void> {
    if (!text) return
    try {
      await this.client!.answerCallback(callbackId, text)
    } catch {
      await this.send(chatId, { text })
    }
  }

  private async deliver(recipient: MaxRecipient, message: OutgoingMessage): Promise<void> {
    const attachments = keyboard(message.buttons)
    const media = message.media ? await this.uploadMedia(message.media.kind, message.media.fileId) : null
    const body: MaxNewMessage = { text: message.text, ...(media || attachments.length ? { attachments: [...(media ? [media] : []), ...attachments] } : {}) }
    await this.client!.sendMessage(recipient, body)
  }

  /** Файл читается из хранилища и загружается в MAX; при сбое сообщение уходит без вложения. */
  private async uploadMedia(kind: 'photo' | 'video', fileId: string): Promise<MaxAttachment | null> {
    try {
      const opened = await this.files.openFile(fileId)
      if (!opened) return null
      const chunks: Buffer[] = []
      for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk as Buffer))
      const name = fileId.split('/').pop() || (kind === 'photo' ? 'photo.jpg' : 'video.mp4')
      return await this.client!.upload(kind === 'photo' ? 'image' : 'video', Buffer.concat(chunks), name)
    } catch (error) {
      this.logger.warn(`Не удалось загрузить медиа ${fileId}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }
}
