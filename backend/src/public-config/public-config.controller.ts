import { Controller, Get } from '@nestjs/common'
import { maxBotUsername } from '../common/max-config.js'

/** Публичные настройки клиента без авторизации: ник бота для ссылок на мини-приложение `max.ru/<бот>?startapp=…`. */
@Controller(['api/public', 'public'])
export class PublicConfigController {
  @Get('config')
  config(): object {
    return { ok: true, data: { bot_username: maxBotUsername() || null } }
  }
}
