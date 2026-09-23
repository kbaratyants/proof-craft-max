import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { maxBotToken } from './common/max-config.js'
import { FeedbackInvitesWorker } from './messenger/feedback-invites.worker.js'
import { MaxAdapter } from './messenger/max/max.adapter.js'
import { MessengerModule } from './messenger/messenger.module.js'

/** Отдельный процесс бота: те же модули и Prisma, что у API, но без HTTP-сервера. */
const bootstrap = async (): Promise<void> => {
  const token = maxBotToken()
  if (!token) {
    // Не ошибка: стек без бота (сайт и API) — допустимая конфигурация, перезапуск не нужен.
    new Logger('Bot').warn('MAX_BOT_TOKEN не задан — бот не запущен. Укажите его в .env и перезапустите контейнер bot.')
    return
  }
  const app = await NestFactory.createApplicationContext(MessengerModule, { logger: ['error', 'warn', 'log'] })
  app.enableShutdownHooks()
  const max = app.get(MaxAdapter)
  max.start(token)
  const invites = app.get(FeedbackInvitesWorker).start(max, process.env.WEB_APP_URL)
  new Logger('Bot').log(`Бот запущен: MAX long polling${invites ? ', очередь приглашений к отзыву' : ''}.`)
}

await bootstrap()
