import { maxBotUsername } from '../../common/max-config.js'
import type { Button } from '../channel.types.js'
import type { MaxAttachment, MaxButton } from './max-bot-api.client.js'

/** Кнопка мини-приложения нужен ник бота; без него — ссылка на сайт с тем же параметром. */
const toMaxButton = (b: Button): MaxButton | null => {
  if ('url' in b) return { type: 'link', text: b.text, url: b.url }
  if ('data' in b) return { type: 'callback', text: b.text, payload: b.data }
  const bot = maxBotUsername()
  if (bot) return { type: 'open_app', text: b.text, web_app: bot, payload: b.openApp }
  const site = process.env.WEB_APP_URL?.trim()
  if (!site) return null
  const url = new URL(site)
  url.searchParams.set(b.openApp, '1')
  return { type: 'link', text: b.text, url: url.toString() }
}

export const keyboard = (buttons: Button[][] | undefined): MaxAttachment[] => {
  const rows = (buttons ?? []).map((row) => row.map(toMaxButton).filter((b): b is MaxButton => b != null)).filter((row) => row.length)
  return rows.length ? [{ type: 'inline_keyboard', payload: { buttons: rows } }] : []
}
