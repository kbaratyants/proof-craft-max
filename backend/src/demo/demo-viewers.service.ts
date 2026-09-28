import { Inject, Injectable, Logger } from '@nestjs/common'
import { MaxInitDataService } from '../auth/max-init-data.service.js'
import { maxBotToken } from '../common/max-config.js'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import type { Button } from '../messenger/channel.types.js'
import { MaxBotApiClient } from '../messenger/max/max-bot-api.client.js'
import { keyboard } from '../messenger/max/max-keyboard.js'
import { PrismaService } from '../persistence/prisma/prisma.service.js'
import { DEMO_ACCOUNTS, DEMO_ROLE_LABELS, type DemoRole, demoRoleOf } from './demo.constants.js'

/** Что открыть от лица роли: подсказки в приветствии и в `/demo`. */
export const DEMO_ROLE_HINTS: Record<DemoRole, string> = {
  admin: '/stats — сводка академии, /admin — заявки и преподаватели',
  teacher: '/teacher — работы на проверке с оценкой прямо в чате',
  student: '/me — мои работы, оценки и отзывы',
}

export const OPEN_DEMO_BUTTON: Button = { text: 'Открыть демо в приложении', openApp: 'demo' }

/**
 * Жюри, открывшее демо из MAX: реальный пользователь MAX ↔ текущая демо-роль (`demo_viewers`).
 * По этой связи бот отвечает на команды от демо-роли, а уведомления демо приходят зрителю в чат.
 */
@Injectable()
export class DemoViewersService {
  private readonly logger = new Logger(DemoViewersService.name)

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MaxInitDataService) private readonly initData: MaxInitDataService,
  ) {}

  /** Реальный пользователь MAX по подписанным данным запуска мини-приложения; без подписи — null. */
  viewerFromInitData(raw: string | undefined): number | null {
    const token = maxBotToken()
    if (!raw || !token) return null
    return this.initData.parseAndValidate(raw.trim(), token, Number(process.env.MAX_INIT_DATA_MAX_AGE_SEC || 86_400))
  }

  async link(viewerMaxUserId: number, role: DemoRole): Promise<void> {
    const viewer = BigInt(viewerMaxUserId)
    const demo = BigInt(DEMO_ACCOUNTS[role])
    const now = sqliteTimestamp()
    await this.prisma.demo_viewers.upsert({
      where: { viewer_max_user_id: viewer },
      create: { viewer_max_user_id: viewer, demo_max_user_id: demo, updated_at: now },
      update: { demo_max_user_id: demo, updated_at: now },
    })
  }

  async unlink(viewerMaxUserId: number): Promise<void> {
    await this.prisma.demo_viewers.deleteMany({ where: { viewer_max_user_id: BigInt(viewerMaxUserId) } })
  }

  async roleOf(viewerMaxUserId: number): Promise<DemoRole | null> {
    const row = await this.prisma.demo_viewers.findUnique({
      where: { viewer_max_user_id: BigInt(viewerMaxUserId) },
      select: { demo_max_user_id: true },
    })
    return row ? demoRoleOf(Number(row.demo_max_user_id)) : null
  }

  /** Приветствие после входа в демо: что будет приходить в чат и какие команды попробовать. */
  async greet(viewerMaxUserId: number, role: DemoRole): Promise<void> {
    await this.deliver(
      viewerMaxUserId,
      `🧪 Вы в демо-академии: ${DEMO_ROLE_LABELS[role]}.\n\n` +
        'Сюда будут приходить уведомления демо — так же, как их получают ученики, преподаватели и администраторы академии.\n\n' +
        `Команды бота тоже работают от этой роли: ${DEMO_ROLE_HINTS[role]}.\n/demo — события эмулятора, смена роли и выход.`,
    )
  }

  /** Сообщение зрителю от бота. Ошибка доставки не должна ломать действие в демо. */
  async deliver(viewerMaxUserId: number, text: string, buttons: Button[][] = [[OPEN_DEMO_BUTTON]]): Promise<void> {
    const token = maxBotToken()
    if (!token) return
    try {
      await new MaxBotApiClient(token).sendMessage({ user_id: viewerMaxUserId }, { text, attachments: keyboard(buttons) })
    } catch (error) {
      this.logger.warn(`Не удалось отправить демо-сообщение в MAX: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
