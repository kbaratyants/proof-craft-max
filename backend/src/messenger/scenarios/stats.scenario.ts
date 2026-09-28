import { Inject, Injectable } from '@nestjs/common'
import { GetAdminAnalyticsUseCase, RemindTeacherQueueUseCase } from '../../admin/admin-analytics.use-cases.js'
import { ListAdminStudentsUseCase } from '../../admin/admin-read.use-cases.js'
import type { Button } from '../channel.types.js'
import { hasRole } from '../messenger-identity.service.js'
import { dataOf, type ScenarioContext } from '../scenario.context.js'
import { demoPrefix, openAppButton } from './info.scenario.js'

type Student = { status: string; student_track: string; teachers: unknown[]; pending_homeworks_count: number }
type TeacherLoad = { teacher_id: number; full_name: string; pending_count: number; oldest_pending_days: number | null }
type Week = { submitted: number; reviewed: number; applications: number }
type Analytics = { teachers: TeacherLoad[]; at_risk: unknown[]; activity: { this_week: Week; previous_week: Week }; inactive_days_threshold: number }

const REMIND = 'stats_remind_'
/** Кнопок «Напомнить» не больше пяти — самые загруженные преподаватели. */
const MAX_REMIND_BUTTONS = 5

const works = (n: number) => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} работа`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} работы`
  return `${n} работ`
}

const trend = (now: number, before: number) => (now > before ? ` ↑ (было ${before})` : now < before ? ` ↓ (было ${before})` : '')

/** `/stats` — сводка академии для администратора и напоминания преподавателям в один тап. */
@Injectable()
export class StatsScenario {
  constructor(
    @Inject(ListAdminStudentsUseCase) private readonly students: ListAdminStudentsUseCase,
    @Inject(GetAdminAnalyticsUseCase) private readonly analytics: GetAdminAnalyticsUseCase,
    @Inject(RemindTeacherQueueUseCase) private readonly remind: RemindTeacherQueueUseCase,
  ) {}

  async stats(context: ScenarioContext): Promise<void> {
    if (!hasRole(context.principal, 'admin')) {
      await context.reply('Сводка академии доступна администраторам.')
      return
    }
    const moderation = dataOf<{ students: Student[] }>(await this.students.execute(context.principal, 'moderation')).students
    const active = dataOf<{ students: Student[] }>(await this.students.execute(context.principal, 'active')).students
    const data = dataOf<Analytics>(await this.analytics.execute(context.principal))
    const studying = active.filter((s) => s.status === 'studying')
    const withoutTeacher = studying.filter((s) => s.student_track !== 'barber' && !s.teachers.length).length
    const pending = active.reduce((sum, s) => sum + Number(s.pending_homeworks_count || 0), 0)
    const { this_week: week, previous_week: before } = data.activity
    const queue = data.teachers.filter((t) => t.pending_count > 0)

    const lines = [
      '📈 Сводка академии',
      '',
      `📝 Заявки на модерации: ${moderation.length}`,
      `🎓 Учатся: ${studying.length}${withoutTeacher ? ` · без преподавателя: ${withoutTeacher}` : ''}`,
      `⏳ Ждут проверки: ${works(pending)}`,
      '',
      'За 7 дней:',
      `• сдано ${works(week.submitted)}${trend(week.submitted, before.submitted)}`,
      `• проверено ${week.reviewed}${trend(week.reviewed, before.reviewed)}`,
      `• новых заявок ${week.applications}${trend(week.applications, before.applications)}`,
    ]
    if (queue.length) {
      lines.push('', 'Очередь проверки:')
      for (const t of queue.slice(0, MAX_REMIND_BUTTONS)) {
        const oldest = t.oldest_pending_days ? `, самая давняя — ${t.oldest_pending_days} дн.` : ''
        lines.push(`• ${t.full_name} — ${works(t.pending_count)}${oldest}`)
      }
    }
    if (data.at_risk.length) {
      lines.push('', `⚠️ Требуют внимания: ${data.at_risk.length} (нет работ ${data.inactive_days_threshold}+ дн. или есть доработки)`)
    }
    const buttons: Button[][] = queue
      .slice(0, MAX_REMIND_BUTTONS)
      .map((t) => [{ text: `🔔 Напомнить: ${t.full_name} (${t.pending_count})`, data: `${REMIND}${t.teacher_id}` }])
    buttons.push([openAppButton(context, 'Вся аналитика в приложении')])
    await context.reply({ text: `${demoPrefix(context)}${lines.join('\n')}`, buttons })
  }

  /** Возвращает true, если нажатие обработано этим сценарием. */
  async handleButton(context: ScenarioContext, data: string, answer: (text?: string) => Promise<void>): Promise<boolean> {
    if (!data.startsWith(REMIND)) return false
    const teacherId = Number(data.slice(REMIND.length))
    const result = dataOf<{ notified: string; pending_count: number }>(await this.remind.execute(context.principal, teacherId))
    await answer('Напоминание отправлено')
    await context.reply(`🔔 Напоминание отправлено: ${result.notified}. Работ на проверке: ${result.pending_count}.`)
    return true
  }
}
