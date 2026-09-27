import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { requireAdminPrincipal } from '../auth/require-admin-principal.js'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import { UserNotificationGateway } from '../notifications/user-notification.gateway.js'
import { AdminHomeworkReminderRepository } from './admin-homework-reminder.repository.js'

const fail = (status: HttpStatus, error: string) => new HttpException({ ok: false, error }, status)

/** Напоминание преподавателям о работе, которая ждёт проверки: уведомление в приложении и в MAX. */
@Injectable()
export class RemindHomeworkReviewUseCase {
  constructor(
    @Inject(AdminHomeworkReminderRepository) private readonly reminders: AdminHomeworkReminderRepository,
    @Inject(UserNotificationGateway) private readonly notifications: UserNotificationGateway,
  ) {}

  async execute(principal: AuthenticatedPrincipal, homeworkId: number): Promise<object> {
    const admin = requireAdminPrincipal(principal)
    const homework = await this.reminders.findPendingHomework(homeworkId)
    if (!homework) throw fail(HttpStatus.NOT_FOUND, 'Работа не найдена или уже проверена.')
    if (!homework.teachers.length) throw fail(HttpStatus.CONFLICT, 'У ученика нет преподавателя — сначала назначьте его.')
    const lesson = homework.isBonus ? 'дополнительному заданию' : `уроку №${homework.lessonNumber}`
    const haircut = homework.haircutName ? ` («${homework.haircutName}»)` : ''
    const body = `Администратор напоминает: работа ${homework.studentName} по ${lesson}${haircut} ждёт проверки с ${homework.createdAt.slice(0, 10)}.`
    await this.reminders.saveReminder({
      actorUserId: admin.id,
      homeworkId: homework.homeworkId,
      studentId: homework.studentId,
      teacherUserIds: homework.teachers.map((t) => t.userId),
      body,
      now: sqliteTimestamp(),
    })
    await Promise.allSettled(homework.teachers.map((t) => this.notifications.send(t.maxUserId, body)))
    return { ok: true, data: { notified: homework.teachers.map((t) => t.fullName) } }
  }
}
