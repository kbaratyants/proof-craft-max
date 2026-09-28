import { Inject, Injectable } from '@nestjs/common'
import { DEMO_ROLE_LABELS, demoEnabled, demoRoleOf } from '../../demo/demo.constants.js'
import { GetSessionUseCase } from '../../session/get-session.use-case.js'
import { ListStudentHomeworksUseCase } from '../../student-homeworks/list-student-homeworks.use-case.js'
import type { Button } from '../channel.types.js'
import { hasRole } from '../messenger-identity.service.js'
import { dataOf, type ScenarioContext } from '../scenario.context.js'

type Review = { teacher_name: string | null; rating: number | null; comment: string | null; created_at: string }
type StudentHomework = {
  status: 'pending' | 'approved' | 'rejected' | 'revision'
  lesson_number: number | null
  is_bonus: boolean
  haircut_name: string | null
  latest_review: Review | null
}

/** В демо — мини-приложение сразу в демо-академии. */
export const openAppButton = (context: ScenarioContext, text = 'Открыть дневник'): Button =>
  ({ text, openApp: context.principal.demoViewerMaxUserId ? 'demo' : 'app' })

/** Пометка в ответах жюри: данные — из демо-академии. */
export const demoPrefix = (context: ScenarioContext): string => {
  if (!context.principal.demoViewerMaxUserId) return ''
  const role = demoRoleOf(context.principal.claimedMaxUserId)
  return `🧪 Демо${role ? ` · ${DEMO_ROLE_LABELS[role]}` : ''}\n\n`
}

const workTitle = (hw: StudentHomework): string =>
  hw.haircut_name || (hw.is_bonus ? 'Дополнительное задание' : `Урок №${hw.lesson_number ?? '—'}`)

/** `/app`, `/help`, `/id`, `/me` — справка и личная сводка ученика. */
@Injectable()
export class InfoScenario {
  constructor(
    @Inject(ListStudentHomeworksUseCase) private readonly homeworks: ListStudentHomeworksUseCase,
    @Inject(GetSessionUseCase) private readonly session: GetSessionUseCase,
  ) {}

  async app(context: ScenarioContext): Promise<void> {
    await context.reply({ text: `${demoPrefix(context)}Дневник академии — работы, оценки, чат с преподавателем.`, buttons: [[openAppButton(context)]] })
  }

  async id(context: ScenarioContext): Promise<void> {
    await context.reply(
      `Ваш ID в MAX: ${context.user.externalId}\n\nПередайте его администратору, если вас нужно назначить преподавателем.`,
    )
  }

  /** Команды по роли пользователя: MAX показывает всем один список, а здесь — только нужное. */
  async help(context: ScenarioContext): Promise<void> {
    const lines = ['/app — открыть дневник академии']
    if (hasRole(context.principal, 'student')) lines.push('/me — мои работы, оценки и последний отзыв')
    if (hasRole(context.principal, 'teacher')) lines.push('/teacher — работы на проверке, оценка прямо в чате')
    if (hasRole(context.principal, 'admin')) {
      lines.push('/stats — сводка академии и напоминания преподавателям', '/admin — заявки и назначение преподавателей')
    }
    lines.push('/id — мой ID в MAX')
    if (demoEnabled()) lines.push('/demo — демо-академия для жюри')
    const intro = context.principal.user?.roles.some((role) => ['student', 'teacher', 'admin'].includes(role))
      ? 'Что умеет бот:'
      : 'Что умеет бот. Чтобы стать учеником, откройте дневник и заполните заявку.'
    await context.reply({ text: `${demoPrefix(context)}${intro}\n\n${lines.join('\n')}`, buttons: [[openAppButton(context)]] })
  }

  async me(context: ScenarioContext): Promise<void> {
    if (!hasRole(context.principal, 'student')) {
      const hint = hasRole(context.principal, 'teacher')
        ? ' Для преподавателя — /teacher.'
        : hasRole(context.principal, 'admin')
          ? ' Для администратора — /stats.'
          : ' Откройте дневник и заполните заявку.'
      await context.reply(`Сводка доступна ученикам академии.${hint}`)
      return
    }
    const data = dataOf<{ homeworks: StudentHomework[]; average_rating: number | null; ratings_count: number }>(
      await this.homeworks.execute(context.principal),
    )
    const session = dataOf<{ student: { full_name: string } | null; unread_notifications_count: number }>(
      await this.session.execute(context.principal),
    )
    const count = (status: StudentHomework['status']) => data.homeworks.filter((hw) => hw.status === status).length
    const lines = [
      `📊 ${session.student?.full_name ?? 'Ваша успеваемость'}`,
      '',
      `Работ сдано: ${data.homeworks.length}`,
      `✅ Принято: ${count('approved')} · ⏳ На проверке: ${count('pending')} · ✏️ На доработке: ${count('revision') + count('rejected')}`,
      data.average_rating != null
        ? `⭐ Средний балл: ${Number(data.average_rating).toFixed(1)} (оценок: ${data.ratings_count})`
        : '⭐ Оценок пока нет',
    ]
    const reviewed = data.homeworks
      .filter((hw) => hw.latest_review)
      .sort((a, b) => b.latest_review!.created_at.localeCompare(a.latest_review!.created_at))[0]
    if (reviewed?.latest_review) {
      const review = reviewed.latest_review
      lines.push(
        '',
        `💬 Последний отзыв — ${workTitle(reviewed)}${review.rating ? `, ${'★'.repeat(review.rating)}` : ''}`,
        `${review.teacher_name ?? 'Преподаватель'}: «${review.comment?.trim() || 'без комментария'}»`,
      )
    }
    if (session.unread_notifications_count > 0) lines.push('', `🔔 Непрочитанных уведомлений: ${session.unread_notifications_count}`)
    await context.reply({ text: `${demoPrefix(context)}${lines.join('\n')}`, buttons: [[openAppButton(context, 'Открыть мои работы')]] })
  }
}
