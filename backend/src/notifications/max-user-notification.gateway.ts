import { Inject, Injectable, Logger } from '@nestjs/common'
import { maxBotToken } from '../common/max-config.js'
import { currentDemoViewer, insideDemoSimulation, isDemoMaxUserId } from '../demo/demo.constants.js'
import { MaxBotApiClient, type MaxNewMessage } from '../messenger/max/max-bot-api.client.js'
import { keyboard } from '../messenger/max/max-keyboard.js'
import { PrismaService } from '../persistence/prisma/prisma.service.js'
import { UserNotificationGateway } from './user-notification.gateway.js'

const ROLE_LABELS: Record<string, string> = { admin: 'администратор', teacher: 'преподаватель', student: 'ученик' }

/** Личные уведомления в MAX от имени бота. Ошибка доставки не отменяет бизнес-операцию. */
@Injectable()
export class MaxUserNotificationGateway implements UserNotificationGateway {
  private readonly logger = new Logger(MaxUserNotificationGateway.name)

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Кому было адресовано уведомление демо: «Ирина Соколова (преподаватель)». */
  private async demoRecipient(maxUserId: number): Promise<string> {
    const user = await this.prisma.users.findUnique({
      where: { max_user_id: BigInt(maxUserId) },
      select: { role: true, first_name: true, last_name: true, teachers: { select: { full_name: true } }, students: { select: { full_name: true } } },
    })
    const name = user?.teachers?.full_name || user?.students?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ')
    const role = ROLE_LABELS[user?.role ?? '']
    return [name, role && `(${role})`].filter(Boolean).join(' ') || 'участник демо-академии'
  }

  async send(maxUserId: number, message: string): Promise<void> {
    const token = maxBotToken()
    if (!token || !maxUserId) return
    const viewer = currentDemoViewer()
    if (isDemoMaxUserId(maxUserId)) {
      // Демо-пользователю писать некуда; если действие сделало жюри из MAX — показываем уведомление ему.
      if (viewer) {
        await this.deliver(token, viewer, {
          text: `🧪 Демо · уведомление для: ${await this.demoRecipient(maxUserId)}\n\n${message}`,
          attachments: keyboard([[{ text: 'Открыть демо в приложении', openApp: 'demo' }]]),
        })
      }
      return
    }
    // Из демо и из эмулятора реальным пользователям сообщения не уходят.
    if (viewer || insideDemoSimulation()) return
    await this.deliver(token, maxUserId, { text: message })
  }

  private async deliver(token: string, maxUserId: number, message: MaxNewMessage): Promise<void> {
    try {
      await new MaxBotApiClient(token).sendMessage({ user_id: maxUserId }, message)
    } catch (error) {
      this.logger.warn(
        `Не удалось отправить уведомление в MAX пользователю ${maxUserId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
