import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma/prisma.service.js'
import {
  AdminHomeworkReminderRepository,
  type PendingHomeworkForReminder,
  type SaveHomeworkReminder,
} from './admin-homework-reminder.repository.js'

@Injectable()
export class PrismaAdminHomeworkReminderRepository extends AdminHomeworkReminderRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super()
  }

  async findPendingHomework(homeworkId: number): Promise<PendingHomeworkForReminder | null> {
    const homework = await this.prisma.homeworks.findFirst({
      where: { id: homeworkId, status: 'pending' },
      select: {
        id: true,
        lesson_number: true,
        is_bonus: true,
        haircut_name: true,
        created_at: true,
        students: {
          select: {
            id: true,
            full_name: true,
            student_teachers: {
              // Активный преподаватель — пользователь с ролью teacher (см. SEC-003).
              where: { teachers: { users: { user_roles: { some: { role: 'teacher' } } } } },
              select: { teachers: { select: { full_name: true, users: { select: { id: true, max_user_id: true } } } } },
            },
          },
        },
      },
    })
    if (!homework) return null
    return {
      homeworkId: homework.id,
      studentId: homework.students.id,
      studentName: homework.students.full_name,
      lessonNumber: homework.lesson_number,
      isBonus: Boolean(homework.is_bonus),
      haircutName: homework.haircut_name,
      createdAt: homework.created_at,
      teachers: homework.students.student_teachers.map(({ teachers }) => ({
        userId: teachers.users.id,
        maxUserId: Number(teachers.users.max_user_id),
        fullName: teachers.full_name,
      })),
    }
  }

  async saveReminder(command: SaveHomeworkReminder): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.app_notifications.createMany({
        data: command.teacherUserIds.map((userId) => ({
          user_id: userId,
          kind: 'homework_reminder',
          body: command.body,
          payload: JSON.stringify({ student_id: command.studentId, homework_id: command.homeworkId }),
          created_at: command.now,
        })),
      }),
      this.prisma.audit_log.create({
        data: {
          actor_user_id: command.actorUserId,
          action: 'homework_review_reminder',
          meta: JSON.stringify({ homework_id: command.homeworkId, teacher_user_ids: command.teacherUserIds }),
          created_at: command.now,
        },
      }),
    ])
  }

  async saveTeacherReminder(command: { actorUserId: number; teacherUserId: number; body: string; now: string }): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.app_notifications.create({
        data: { user_id: command.teacherUserId, kind: 'homework_reminder', body: command.body, payload: null, created_at: command.now },
      }),
      this.prisma.audit_log.create({
        data: {
          actor_user_id: command.actorUserId,
          action: 'teacher_queue_reminder',
          meta: JSON.stringify({ teacher_user_id: command.teacherUserId }),
          created_at: command.now,
        },
      }),
    ])
  }
}
