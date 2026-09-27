import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { requireAdminPrincipal } from '../auth/require-admin-principal.js'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import { UserNotificationGateway } from '../notifications/user-notification.gateway.js'
import { AdminAnalyticsRepository } from './admin-analytics.repository.js'
import { AdminHomeworkReminderRepository } from './admin-homework-reminder.repository.js'

const DAY = 86_400_000
/** Ученик отстаёт, если не сдавал работ дольше этого срока. */
export const INACTIVE_DAYS = 14

const ms = (timestamp: string): number => Date.parse(`${timestamp.replace(' ', 'T')}Z`)
const round1 = (value: number): number => Math.round(value * 10) / 10

/** «1 работа ждёт», «3 работы ждут», «7 работ ждут». */
const worksWaiting = (n: number): string => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} работа ждёт`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} работы ждут`
  return `${n} работ ждут`
}

/** Аналитика академии для администратора: нагрузка преподавателей, отстающие ученики, активность по неделям. */
@Injectable()
export class GetAdminAnalyticsUseCase {
  constructor(@Inject(AdminAnalyticsRepository) private readonly analytics: AdminAnalyticsRepository) {}

  async execute(principal: AuthenticatedPrincipal, now = Date.now()): Promise<object> {
    requireAdminPrincipal(principal)
    const data = await this.analytics.snapshot(sqliteTimestamp(now - 30 * DAY), sqliteTimestamp(now - 14 * DAY))
    const weekAgo = now - 7 * DAY
    const inWeek = (list: string[], from: number, to: number) => list.filter((t) => ms(t) >= from && ms(t) < to).length

    const teachers = data.teachers
      .map((t) => {
        const own = data.reviews.filter((r) => r.teacherId === t.teacherId)
        const hours = own.map((r) => (ms(r.reviewedAt) - ms(r.submittedAt)) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0)
        const oldest = [...t.pendingCreatedAt].sort()[0] ?? null
        return {
          teacher_id: t.teacherId,
          full_name: t.fullName,
          students_count: t.studentsCount,
          pending_count: t.pendingCreatedAt.length,
          oldest_pending_at: oldest,
          oldest_pending_days: oldest ? Math.floor((now - ms(oldest)) / DAY) : null,
          avg_review_hours: hours.length ? round1(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
          reviewed_7d: own.filter((r) => ms(r.reviewedAt) >= weekAgo).length,
        }
      })
      .sort((a, b) => b.pending_count - a.pending_count || a.full_name.localeCompare(b.full_name, 'ru'))

    const atRisk = data.students
      .map((s) => {
        const since = s.lastSubmittedAt ?? s.createdAt
        const idleDays = Math.floor((now - ms(since)) / DAY)
        const reasons: string[] = []
        if (!s.lastSubmittedAt && idleDays >= INACTIVE_DAYS) reasons.push(`не сдал ни одной работы за ${idleDays} дн.`)
        else if (s.lastSubmittedAt && idleDays >= INACTIVE_DAYS) reasons.push(`не сдавал работ ${idleDays} дн.`)
        if (s.revisionCount > 0) reasons.push(`на доработке: ${s.revisionCount}`)
        return {
          student_id: s.studentId,
          full_name: s.fullName,
          last_submitted_at: s.lastSubmittedAt,
          idle_days: idleDays,
          revision_count: s.revisionCount,
          pending_count: s.pendingCount,
          reasons,
        }
      })
      .filter((s) => s.reasons.length > 0)
      .sort((a, b) => b.idle_days - a.idle_days)

    const week = (from: number, to: number) => ({
      submitted: inWeek(data.submittedAt, from, to),
      reviewed: inWeek(data.reviewedAt, from, to),
      applications: inWeek(data.applicationsAt, from, to),
    })

    return {
      ok: true,
      data: {
        teachers,
        at_risk: atRisk,
        activity: { this_week: week(weekAgo, now + 1), previous_week: week(now - 14 * DAY, weekAgo) },
        inactive_days_threshold: INACTIVE_DAYS,
      },
    }
  }
}

/** Одно напоминание преподавателю обо всех работах, которые ждут его проверки. */
@Injectable()
export class RemindTeacherQueueUseCase {
  constructor(
    @Inject(AdminAnalyticsRepository) private readonly analytics: AdminAnalyticsRepository,
    @Inject(AdminHomeworkReminderRepository) private readonly reminders: AdminHomeworkReminderRepository,
    @Inject(UserNotificationGateway) private readonly notifications: UserNotificationGateway,
  ) {}

  async execute(principal: AuthenticatedPrincipal, teacherId: number): Promise<object> {
    const admin = requireAdminPrincipal(principal)
    const now = Date.now()
    const data = await this.analytics.snapshot(sqliteTimestamp(now), sqliteTimestamp(now))
    const teacher = data.teachers.find((t) => t.teacherId === teacherId)
    if (!teacher) throw new HttpException({ ok: false, error: 'Преподаватель не найден.' }, HttpStatus.NOT_FOUND)
    if (!teacher.pendingCreatedAt.length) {
      throw new HttpException({ ok: false, error: 'У преподавателя нет работ на проверке.' }, HttpStatus.CONFLICT)
    }
    const oldest = [...teacher.pendingCreatedAt].sort()[0]!
    const body = `Администратор напоминает: ${worksWaiting(teacher.pendingCreatedAt.length)} вашей проверки, самая ранняя — с ${oldest.slice(0, 10)}.`
    await this.reminders.saveTeacherReminder({ actorUserId: admin.id, teacherUserId: teacher.userId, body, now: sqliteTimestamp(now) })
    await this.notifications.send(teacher.maxUserId, body).catch(() => {})
    return { ok: true, data: { notified: teacher.fullName, pending_count: teacher.pendingCreatedAt.length } }
  }
}
