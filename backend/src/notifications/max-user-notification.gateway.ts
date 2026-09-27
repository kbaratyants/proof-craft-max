import { Injectable, Logger } from '@nestjs/common'
import { maxBotToken } from '../common/max-config.js'
import { insideDemoSimulation, isDemoMaxUserId } from '../demo/demo.constants.js'
import { MaxBotApiClient } from '../messenger/max/max-bot-api.client.js'
import { UserNotificationGateway } from './user-notification.gateway.js'

/** Личные уведомления в MAX от имени бота. Ошибка доставки не отменяет бизнес-операцию. */
@Injectable()
export class MaxUserNotificationGateway implements UserNotificationGateway {
  private readonly logger = new Logger(MaxUserNotificationGateway.name)

  async send(maxUserId: number, message: string): Promise<void> {
    const token = maxBotToken()
    if (!token || !maxUserId) return
    // Демо-пользователям и событиям эмулятора сообщения в MAX не отправляются.
    if (isDemoMaxUserId(maxUserId) || insideDemoSimulation()) return
    try {
      await new MaxBotApiClient(token).sendMessage({ user_id: maxUserId }, { text: message })
    } catch (error) {
      this.logger.warn(
        `Не удалось отправить уведомление в MAX пользователю ${maxUserId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
