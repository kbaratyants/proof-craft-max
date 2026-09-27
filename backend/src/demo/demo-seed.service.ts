import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import { PrismaService } from '../persistence/prisma/prisma.service.js'
import { ObjectStorage } from '../storage/object-storage.js'
import { newObjectKey } from '../storage/staging.js'
import {
  ABOUT_STUDENT,
  ABOUT_TEACHER,
  CHAT_MESSAGES,
  HAIRCUTS,
  METRO,
  REVISION_COMMENTS,
  STUDENT_NOTES,
  TEACHER_COMMENTS,
  pick,
  randomPhone,
} from './demo-content.js'
import { DEMO_ACCOUNTS, DEMO_ID_BASE, demoEnabled } from './demo.constants.js'
import { type DemoSnapshot, loadDemoSnapshot } from './demo-snapshot.js'
import { demoPortrait, demoWorkPhoto } from './demo-photos.js'

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0]
const DAY = 86_400_000
const ago = (days: number, hours = 0): string => sqliteTimestamp(Date.now() - days * DAY - hours * 3_600_000)

type StudentPlan = {
  name: [string, string]
  track: 'student' | 'intern' | 'barber'
  status: 'studying' | 'completed' | 'moderation'
  lessons: number
  approved: number
  pending?: boolean
  revision?: boolean
  maxUserId?: number
}

/** Ученики демо-академии. Первый — аккаунт «Ученик» для входа жюри. */
const STUDENTS: StudentPlan[] = [
  { name: ['Артём', 'Лебедев'], track: 'student', status: 'studying', lessons: 12, approved: 5, pending: true, revision: true, maxUserId: DEMO_ACCOUNTS.student },
  { name: ['Максим', 'Орлов'], track: 'student', status: 'studying', lessons: 10, approved: 3, pending: true },
  { name: ['Егор', 'Соловьёв'], track: 'intern', status: 'studying', lessons: 16, approved: 9 },
  { name: ['Дарья', 'Волкова'], track: 'student', status: 'studying', lessons: 8, approved: 2, revision: true },
  { name: ['Никита', 'Зайцев'], track: 'barber', status: 'studying', lessons: 20, approved: 14 },
  { name: ['Полина', 'Морозова'], track: 'student', status: 'completed', lessons: 10, approved: 10 },
  { name: ['Илья', 'Павлов'], track: 'student', status: 'moderation', lessons: 10, approved: 0 },
]

/**
 * Демо-академия для жюри. Если задан DEMO_SNAPSHOT_PATH — из анонимизированного снимка,
 * иначе синтетическая: администратор, преподаватели, ученики с работами, проверками и чатом.
 * Создаётся один раз при старте API с DEMO_MODE; `reset()` пересоздаёт её с нуля.
 */
@Injectable()
export class DemoSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DemoSeedService.name)
  private nextId = DEMO_ID_BASE + 100

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!demoEnabled()) return
    try {
      if (await this.prisma.users.findUnique({ where: { max_user_id: BigInt(DEMO_ACCOUNTS.admin) }, select: { id: true } })) return
      await this.seed()
    } catch (error) {
      this.logger.error(`Не удалось создать демо-данные: ${error instanceof Error ? error.stack : String(error)}`)
    }
  }

  async seed(): Promise<void> {
    const snapshot = loadDemoSnapshot()
    if (snapshot) await this.seedFromSnapshot(snapshot)
    else await this.seedSynthetic()
    this.logger.log(snapshot ? 'Демо-академия создана из снимка.' : 'Демо-академия создана.')
  }

  /** Удаляет всех демо-пользователей (с их работами, сессиями и сгенерированными фото) и создаёт академию заново. */
  async reset(): Promise<void> {
    const demoUsers = { max_user_id: { gte: BigInt(DEMO_ID_BASE) } }
    const files = await this.prisma.homeworks.findMany({
      where: { students: { users: demoUsers } },
      select: { file_id: true, homework_files: { select: { file_id: true } } },
    })
    const avatars = await this.prisma.students.findMany({ where: { users: demoUsers }, select: { avatar_file_id: true } })
    const keys = [
      ...files.flatMap((h) => [h.file_id, ...h.homework_files.map((f) => f.file_id)]),
      ...avatars.map((a) => a.avatar_file_id),
    ].filter((key): key is string => Boolean(key) && !key!.startsWith('demo/import/'))
    const ids = (await this.prisma.users.findMany({ where: demoUsers, select: { id: true } })).map((u) => u.id)
    await this.prisma.$transaction([
      this.prisma.audit_log.deleteMany({ where: { actor_user_id: { in: ids } } }),
      this.prisma.users.deleteMany({ where: { id: { in: ids } } }),
    ])
    await Promise.all(keys.map((key) => this.storage.delete(key)))
    await this.seed()
  }

  private async putPhoto(folder: string, body: Buffer): Promise<string> {
    const key = newObjectKey(folder, '.jpg')
    await this.storage.put(key, { buffer: body }, 'image/jpeg')
    return key
  }

  private async user(tx: Tx, maxUserId: number, firstName: string, lastName: string, roles: string[], createdAt: string): Promise<number> {
    const user = await tx.users.create({
      data: {
        max_user_id: BigInt(maxUserId),
        first_name: firstName,
        last_name: lastName,
        role: roles[0]!,
        created_at: createdAt,
        updated_at: createdAt,
        user_roles: { create: roles.map((role) => ({ role, created_at: createdAt })) },
      },
      select: { id: true },
    })
    return user.id
  }

  private async seedFromSnapshot(snapshot: DemoSnapshot): Promise<void> {
    const studentAvatar = await this.putPhoto('demo/avatars', demoPortrait('student'))
    await this.prisma.$transaction(async (tx) => {
      const createdAt = ago(60)
      const adminUserId = await this.user(tx, DEMO_ACCOUNTS.admin, 'Администратор', 'Демо', ['admin'], createdAt)
      const teacherIds = new Map<string, { id: number; userId: number }>()
      for (const t of snapshot.teachers) {
        const userId = await this.user(tx, t.demoAccount ? DEMO_ACCOUNTS.teacher : this.nextId++, t.firstName, t.lastName, ['teacher'], createdAt)
        const teacher = await tx.teachers.create({
          data: { user_id: userId, full_name: `${t.firstName} ${t.lastName}`, about_me: t.about, created_at: createdAt, updated_at: createdAt },
        })
        teacherIds.set(t.key, { id: teacher.id, userId })
      }
      const studentIds = new Map<string, { id: number; userId: number }>()
      for (const st of snapshot.students) {
        const userId = await this.user(tx, st.demoAccount ? DEMO_ACCOUNTS.student : this.nextId++, st.firstName, st.lastName, ['student'], st.createdAt)
        const student = await tx.students.create({
          data: {
            user_id: userId,
            full_name: `${st.firstName} ${st.lastName}`,
            phone: st.phone,
            lessons_count: st.lessons,
            status: st.status,
            student_track: st.track,
            metro: st.metro,
            about_me: st.about,
            avatar_file_id: st.demoAccount ? studentAvatar : null,
            created_at: st.createdAt,
            updated_at: st.createdAt,
          },
        })
        studentIds.set(st.key, { id: student.id, userId })
        for (const key of st.teacherKeys) {
          const teacher = teacherIds.get(key)
          if (teacher) await tx.student_teachers.create({ data: { student_id: student.id, teacher_id: teacher.id, created_at: st.createdAt } })
        }
      }
      const authorUserId = (key: string): number | undefined => teacherIds.get(key)?.userId ?? studentIds.get(key)?.userId
      for (const hw of snapshot.homeworks) {
        const student = studentIds.get(hw.studentKey)
        if (!student) continue
        const homework = await tx.homeworks.create({
          data: {
            student_id: student.id, lesson_number: hw.lesson, is_bonus: hw.isBonus ? 1 : 0, content_type: hw.contentType,
            file_id: hw.fileKey, text_content: hw.text, status: hw.status, haircut_name: hw.haircut,
            revision_student_text: hw.revisionText, created_at: hw.createdAt, updated_at: hw.updatedAt,
          },
        })
        for (const f of hw.files) {
          await tx.homework_files.create({ data: { homework_id: homework.id, file_id: f.fileKey, content_type: f.contentType, sort_order: f.sortOrder, created_at: hw.createdAt } })
        }
        for (const r of hw.reviews) {
          const teacher = teacherIds.get(r.teacherKey)
          if (!teacher) continue
          await tx.homework_reviews.create({
            data: { homework_id: homework.id, teacher_id: teacher.id, rating: r.rating, comment: r.comment, status: r.status, created_at: r.createdAt, updated_at: r.createdAt },
          })
        }
        for (const c of hw.comments) {
          const author = authorUserId(c.authorKey)
          if (author) await tx.homework_comments.create({ data: { homework_id: homework.id, author_user_id: author, text_content: c.text, created_at: c.createdAt } })
        }
      }
      const applicantUserId = await this.user(tx, this.nextId++, 'Олег', 'Кандидатов', ['guest'], ago(1))
      await tx.teacher_applications.create({
        data: { applicant_user_id: applicantUserId, full_name: 'Олег Кандидатов', phone: randomPhone(), status: 'pending', created_at: ago(1), updated_at: ago(1) },
      })
      await tx.app_notifications.create({
        data: { user_id: adminUserId, kind: 'demo_welcome', body: 'Добро пожаловать в демо-академию! Откройте панель «Демо», чтобы создавать новые события.', created_at: sqliteTimestamp() },
      })
    }, { timeout: 120_000 })
  }

  private async seedSynthetic(): Promise<void> {
    // Фото загружаются до транзакции: SQLite-транзакция не должна ждать сети S3.
    const plannedPhotos = STUDENTS.reduce((sum, s) => sum + s.approved + (s.pending ? 2 : 0) + (s.revision ? 1 : 0), 0)
    const photos: string[] = []
    for (let i = 0; i < plannedPhotos; i += 1) photos.push(await this.putPhoto('demo/homeworks', await demoWorkPhoto()))
    const studentAvatar = await this.putPhoto('demo/avatars', demoPortrait('student'))
    const nextPhoto = (): string => photos.pop()!

    await this.prisma.$transaction(async (tx) => {
      const createdAt = ago(40)
      const adminUserId = await this.user(tx, DEMO_ACCOUNTS.admin, 'Администратор', 'Демо', ['admin'], createdAt)
      const teacherUserId = await this.user(tx, DEMO_ACCOUNTS.teacher, 'Ирина', 'Соколова', ['teacher'], createdAt)
      const secondTeacherUserId = await this.user(tx, this.nextId++, 'Дмитрий', 'Кравцов', ['teacher'], createdAt)
      const teacher = await tx.teachers.create({
        data: { user_id: teacherUserId, full_name: 'Ирина Соколова', about_me: ABOUT_TEACHER, created_at: createdAt, updated_at: createdAt },
      })
      const secondTeacher = await tx.teachers.create({
        data: { user_id: secondTeacherUserId, full_name: 'Дмитрий Кравцов', about_me: 'Специализируюсь на бороде и классических стрижках.', created_at: createdAt, updated_at: createdAt },
      })

      for (const [index, plan] of STUDENTS.entries()) {
        const [firstName, lastName] = plan.name
        const joined = ago(35 - index * 2)
        const userId = await this.user(tx, plan.maxUserId ?? this.nextId++, firstName, lastName, ['student'], joined)
        const student = await tx.students.create({
          data: {
            user_id: userId,
            full_name: `${firstName} ${lastName}`,
            phone: randomPhone(),
            lessons_count: plan.lessons,
            status: plan.status,
            student_track: plan.track,
            metro: pick(METRO),
            about_me: index === 0 ? ABOUT_STUDENT : null,
            avatar_file_id: index === 0 ? studentAvatar : null,
            created_at: joined,
            updated_at: joined,
          },
        })
        if (plan.status === 'moderation') continue
        const mentor = index % 3 === 2 ? secondTeacher : teacher
        if (plan.track !== 'barber') {
          await tx.student_teachers.create({ data: { student_id: student.id, teacher_id: mentor.id, created_at: joined } })
          if (index === 0) await tx.student_teachers.create({ data: { student_id: student.id, teacher_id: secondTeacher.id, created_at: joined } })
        }

        let lesson = 1
        for (let n = 0; n < plan.approved; n += 1, lesson += 1) {
          const when = ago(30 - n * 2 - index, 3)
          const homework = await tx.homeworks.create({
            data: { student_id: student.id, lesson_number: lesson, content_type: 'photo', file_id: nextPhoto(), text_content: pick(STUDENT_NOTES), status: 'approved', haircut_name: pick(HAIRCUTS), created_at: when, updated_at: when },
          })
          await tx.homework_reviews.create({
            data: { homework_id: homework.id, teacher_id: mentor.id, rating: 3 + Math.floor(Math.random() * 3), comment: pick(TEACHER_COMMENTS), status: 'approved', created_at: when, updated_at: when },
          })
        }
        if (plan.revision) {
          const when = ago(3, index)
          const homework = await tx.homeworks.create({
            data: { student_id: student.id, lesson_number: lesson++, content_type: 'photo', file_id: nextPhoto(), text_content: pick(STUDENT_NOTES), status: 'revision', haircut_name: pick(HAIRCUTS), created_at: when, updated_at: when },
          })
          await tx.homework_reviews.create({
            data: { homework_id: homework.id, teacher_id: mentor.id, rating: null, comment: pick(REVISION_COMMENTS), status: 'rejected', created_at: when, updated_at: when },
          })
          await tx.homework_comments.create({
            data: { homework_id: homework.id, author_user_id: userId, text_content: 'Понял, переделаю на следующей модели.', created_at: when },
          })
        }
        if (plan.pending) {
          const when = ago(0, 5 + index)
          const homework = await tx.homeworks.create({
            data: { student_id: student.id, lesson_number: lesson++, content_type: 'photo', file_id: nextPhoto(), text_content: pick(STUDENT_NOTES), status: 'pending', haircut_name: pick(HAIRCUTS), created_at: when, updated_at: when },
          })
          await tx.homework_files.create({ data: { homework_id: homework.id, file_id: nextPhoto(), content_type: 'photo', sort_order: 1, created_at: when } })
        }
        if (index < 3) {
          await tx.chat_messages.create({ data: { student_id: student.id, sender_user_id: userId, text_content: pick(CHAT_MESSAGES), content_type: 'text', created_at: ago(1, index) } })
          await tx.chat_messages.create({ data: { student_id: student.id, sender_user_id: mentor.user_id, text_content: 'Да, конечно. Жду вас, возьмите машинку и шейвер.', content_type: 'text', created_at: ago(1, index - 1) } })
        }
      }

      const applicantUserId = await this.user(tx, this.nextId++, 'Олег', 'Кандидатов', ['guest'], ago(1))
      await tx.teacher_applications.create({
        data: { applicant_user_id: applicantUserId, full_name: 'Олег Кандидатов', phone: randomPhone(), status: 'pending', created_at: ago(1), updated_at: ago(1) },
      })
      await tx.app_notifications.create({
        data: { user_id: adminUserId, kind: 'demo_welcome', body: 'Добро пожаловать в демо-академию! Откройте панель «Демо», чтобы создавать новые события.', created_at: sqliteTimestamp() },
      })
    }, { timeout: 30_000 })
  }
}
