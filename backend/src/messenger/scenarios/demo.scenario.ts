import { Inject, Injectable } from '@nestjs/common'
import { DEMO_ACCOUNTS, DEMO_ROLE_LABELS, type DemoRole, demoEnabled, demoRoleOf } from '../../demo/demo.constants.js'
import { DEMO_ACTIONS, type DemoAction, DemoSimulationService } from '../../demo/demo-simulation.service.js'
import { DEMO_ROLE_HINTS, DemoViewersService, OPEN_DEMO_BUTTON } from '../../demo/demo-viewers.service.js'
import type { Button } from '../channel.types.js'
import type { ScenarioContext } from '../scenario.context.js'

const ROLE = 'demo_role_'
const SIMULATE = 'demo_sim_'
const EXIT = 'demo_exit'

const ACTION_LABELS: Record<DemoAction, string> = {
  homework: '📷 Ученик сдаёт работу',
  student_application: '📝 Новая заявка ученика',
  teacher_application: '👨‍🏫 Заявка преподавателя',
  chat_message: '💬 Сообщение в чат',
  profile_edit: '✏️ Запрос правки профиля',
}

const ROLES = Object.keys(DEMO_ACCOUNTS) as DemoRole[]

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * `/demo` — демо-академия для жюри прямо в чате: выбор роли, события эмулятора и выход.
 * Роль в чате хранится в `demo_viewers`; вход в демо из мини-приложения выставляет её же.
 */
@Injectable()
export class DemoScenario {
  constructor(
    @Inject(DemoViewersService) private readonly viewers: DemoViewersService,
    @Inject(DemoSimulationService) private readonly simulation: DemoSimulationService,
  ) {}

  async menu(context: ScenarioContext): Promise<void> {
    if (!demoEnabled()) {
      await context.reply('Демо-режим на этом стенде выключен.')
      return
    }
    const role = context.principal.demoViewerMaxUserId ? demoRoleOf(context.principal.claimedMaxUserId) : null
    if (role) {
      await this.roleCard(context, role)
      return
    }
    await context.reply({
      text:
        '🧪 Демо-академия для жюри: готовые ученики, работы, оценки и чаты.\n\n' +
        'Откройте демо в приложении или выберите роль здесь — тогда команды бота будут работать от неё, ' +
        'а уведомления демо начнут приходить в этот чат.',
      buttons: [[OPEN_DEMO_BUTTON], ROLES.map((r) => ({ text: capitalized(DEMO_ROLE_LABELS[r]), data: `${ROLE}${r}` }))],
    })
  }

  /** Возвращает true, если нажатие обработано этим сценарием. */
  async handleButton(context: ScenarioContext, data: string, answer: (text?: string) => Promise<void>): Promise<boolean> {
    if (!data.startsWith('demo_')) return false
    if (!demoEnabled()) {
      await answer('Демо-режим выключен')
      return true
    }
    const viewer = context.user.externalId
    if (data === EXIT) {
      await this.viewers.unlink(viewer)
      await answer('Вы вышли из демо')
      await context.reply('Вы вышли из демо в чате. Бот снова отвечает от вашей учётной записи.')
      return true
    }
    if (data.startsWith(ROLE)) {
      const role = data.slice(ROLE.length) as DemoRole
      if (!ROLES.includes(role)) return true
      await this.viewers.link(viewer, role)
      await answer(`Роль: ${DEMO_ROLE_LABELS[role]}`)
      await this.roleCard(context, role)
      return true
    }
    if (data.startsWith(SIMULATE)) {
      const action = data.slice(SIMULATE.length) as DemoAction
      if (!DEMO_ACTIONS.includes(action)) return true
      if (!context.principal.demoViewerMaxUserId) {
        await context.reply('Сначала выберите роль в демо: /demo')
        return true
      }
      const message = await this.simulation.simulate(context.principal, action)
      await answer('Событие создано')
      await context.reply(`🧪 ${message}`)
      return true
    }
    return true
  }

  private async roleCard(context: ScenarioContext, role: DemoRole): Promise<void> {
    const buttons: Button[][] = [
      ...DEMO_ACTIONS.map((action) => [{ text: ACTION_LABELS[action], data: `${SIMULATE}${action}` }]),
      ROLES.filter((r) => r !== role).map((r) => ({ text: `Стать: ${DEMO_ROLE_LABELS[r]}`, data: `${ROLE}${r}` })),
      [OPEN_DEMO_BUTTON],
      [{ text: 'Выйти из демо', data: EXIT }],
    ]
    await context.reply({
      text:
        `🧪 Вы в демо-академии: ${DEMO_ROLE_LABELS[role]}.\n\n` +
        `Команды: ${DEMO_ROLE_HINTS[role]}.\n\n` +
        'Эмулятор ниже создаёт события от других участников — уведомления о них придут в этот чат.',
      buttons,
    })
  }
}
