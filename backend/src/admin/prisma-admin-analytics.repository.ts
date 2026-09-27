import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma/prisma.service.js'
import { AdminAnalyticsRepository, type AnalyticsSnapshot } from './admin-analytics.repository.js'

const ACTIVE_TEACHER = { users: { user_roles: { some: { role: 'teacher' } } } }

@Injectable()
export class PrismaAdminAnalyticsRepository extends AdminAnalyticsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super()
  }

  async snapshot(since30: string, since14: string): Promise<AnalyticsSnapshot> {
    const [teachers, reviews, students, submitted, reviewed, studentApps, teacherApps] = await Promise.all([
      this.prisma.teachers.findMany({
        where: ACTIVE_TEACHER,
        select: {
          id: true,
          full_name: true,
          users: { select: { id: true, max_user_id: true } },
          student_teachers: {
            where: { students: { status: { in: ['studying', 'completed'] } } },
            select: { students: { select: { homeworks: { where: { status: 'pending' }, select: { created_at: true } } } } },
          },
        },
      }),
      this.prisma.homework_reviews.findMany({
        where: { created_at: { gte: since30 } },
        select: { teacher_id: true, created_at: true, homeworks: { select: { created_at: true } } },
      }),
      this.prisma.students.findMany({
        where: { status: 'studying' },
        select: {
          id: true,
          full_name: true,
          created_at: true,
          homeworks: { select: { created_at: true, status: true } },
        },
      }),
      this.prisma.homeworks.findMany({ where: { created_at: { gte: since14 } }, select: { created_at: true } }),
      this.prisma.homework_reviews.findMany({ where: { created_at: { gte: since14 } }, select: { created_at: true } }),
      this.prisma.students.findMany({ where: { created_at: { gte: since14 } }, select: { created_at: true } }),
      this.prisma.teacher_applications.findMany({ where: { created_at: { gte: since14 } }, select: { created_at: true } }),
    ])
    return {
      teachers: teachers.map((t) => ({
        teacherId: t.id,
        userId: t.users.id,
        maxUserId: Number(t.users.max_user_id),
        fullName: t.full_name,
        studentsCount: t.student_teachers.length,
        pendingCreatedAt: t.student_teachers.flatMap(({ students }) => students.homeworks.map((h) => h.created_at)),
      })),
      reviews: reviews.map((r) => ({ teacherId: r.teacher_id, reviewedAt: r.created_at, submittedAt: r.homeworks.created_at })),
      students: students.map((s) => ({
        studentId: s.id,
        fullName: s.full_name,
        createdAt: s.created_at,
        lastSubmittedAt: s.homeworks.map((h) => h.created_at).sort().at(-1) ?? null,
        pendingCount: s.homeworks.filter((h) => h.status === 'pending').length,
        revisionCount: s.homeworks.filter((h) => h.status === 'revision').length,
      })),
      submittedAt: submitted.map((h) => h.created_at),
      reviewedAt: reviewed.map((r) => r.created_at),
      applicationsAt: [...studentApps, ...teacherApps].map((a) => a.created_at),
    }
  }
}
