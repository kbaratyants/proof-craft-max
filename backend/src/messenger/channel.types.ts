/**
 * Мессенджер-независимая модель бота. Адаптер мессенджера превращает свои обновления
 * в `IncomingEvent` и реализует `ChannelPort` для ответов. Сценарии работают только с этими типами.
 */

export type ChannelKind = 'max'

export type ChannelUser = {
  channel: ChannelKind
  /** Идентификатор пользователя в мессенджере. */
  externalId: number
  username: string | null
  firstName: string | null
  lastName: string | null
}

export type IncomingEvent =
  | { kind: 'command'; user: ChannelUser; chatId: number; command: string; args: string }
  | { kind: 'message'; user: ChannelUser; chatId: number; text: string | null }
  | { kind: 'button'; user: ChannelUser; chatId: number; data: string; callbackId: string }

export type Button = { text: string; data: string } | { text: string; url: string }

export type OutgoingMedia = {
  kind: 'photo' | 'video'
  /** Ключ файла в хранилище (`homeworks.file_id`). */
  fileId: string
}

export type OutgoingMessage = {
  text: string
  buttons?: Button[][]
  media?: OutgoingMedia
}

export interface ChannelPort {
  readonly kind: ChannelKind
  /** Ответ в чат, из которого пришло событие. */
  send(chatId: number, message: OutgoingMessage): Promise<void>
  /** Личное сообщение пользователю по его идентификатору в мессенджере. */
  sendToUser(userId: number, message: OutgoingMessage): Promise<void>
  /** Подтверждение нажатия кнопки; текст показывается пользователю. */
  answerButton(chatId: number, callbackId: string, text?: string): Promise<void>
}
