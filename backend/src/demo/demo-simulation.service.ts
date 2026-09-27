import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { SendChatMessageUseCase } from '../chat/send-chat-message.use-case.js'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import { PrismaService } from '../persistence/prisma/prisma.service.js'
import { UserIdentityRepository } from '../persistence/users/user-identity.repository.js'
import { SubmitStudentProfileEditUseCase } from '../profiles/submit-student-profile-edit.use-case.js'
import { RegisterStudentUseCase } from '../registration/register-student.use-case.js'
import { SubmitTeacherApplicationUseCase } from '../registration/submit-teacher-application.use-case.js'
import { HomeworkSubmissionStorage } from '../student-homeworks/homework-submission.storage.js'
import { SubmitHomeworkUseCase } from '../student-homeworks/submit-homework.use-case.js'
import { CHAT_MESSAGES, HAIRCUTS, METRO, STUDENT_NOTES, pick, randomPerson, randomPhone } from './demo-content.js'
import { DEMO_ACCOUNTS, DEMO_ID_BASE, type DemoRole, isDemoMaxUserId, runAsDemoSimulation } from './demo.constants.js'
import { demoWorkPhoto } from './demo-photos.js'

export const DEMO_ACTIONS = ['homework', 'student_application', 'teacher_application', 'chat_message', 'profile_edit'] as const
export type DemoAction = (typeof DEMO_ACTIONS)[number]

const SESSION_TTL_MS = 24 * 3_600_000
const fail = (status: HttpStatus, error: string) => new HttpException({ ok: false, error }, status)

/**
 * Вход жюри по ролям и эмулятор событий демо-академии. Все события проходят через обычные use cases
 * (уведомления, модерация, проверка), но выполняются от имени демо-пользователей и без сообщений в MAX.
 */
@Injectable()
export class DemoSimulationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UserIdentityRepository) private readonly users: UserIdentityRepository,
    @Inject(SubmitHomeworkUseCase) private readonly submitHomework: SubmitHomeworkUseCase,
    @Inject(HomeworkSubmissionStorage) private readonly homeworkStorage: HomeworkSubmissionStorage,
    @Inject(RegisterStudentUseCase) private readonly registerStudent: RegisterStudentUseCase,
    @Inject(SubmitTeacherApplicationUseCase) private readonly teacherApplication: SubmitTeacherApplicationUseCase,
    @Inject(SendChatMessageUseCase) private readonly sendChatMessage: SendChatMessageUseCase,
    @Inject(SubmitStudentProfileEditUseCase) private readonly profileEdit: SubmitStudentProfileEditUseCase,
  ) {}

  /** Web-сессия демо-пользователя выбранной роли — тот же механизм, что у входа через MAX. */
  async login(role: DemoRole): Promise<{ session_token: string; max_user_id: number }> {
    const maxUserId = DEMO_ACCOUNTS[role]
    const user = await this.prisma.users.findUnique({ where: { max_user_id: BigInt(maxUserId) }, select: { id: true } })
    if (!user) throw fail(HttpStatus.SERVICE_UNAVAILABLE, 'Демо-данные ещё создаются. Обновите страницу через минуту.')
    const token = crypto.randomBytes(32).toString('base64url')
    const now = Date.now()
    await this.prisma.web_sessions.create({
      data: {
        user_id: user.id,
        token_hash: crypto.createHash('sha256').update(token, 'utf8').digest('hex'),
        expires_at: sqliteTimestamp(now + SESSION_TTL_MS),
        last_seen_at: sqliteTimestamp(now),
        created_at: sqliteTimestamp(now),
      },
    })
    return { session_token: token, max_user_id: maxUserId }
  }

  async simulate(caller: AuthenticatedPrincipal, action: DemoAction): Promise<string> {
    if (!caller.user || !isDemoMaxUserId(caller.user.maxUserId)) {
      throw fail(HttpStatus.FORBIDDEN, 'Эмулятор доступен только в демо-сессии.')
    }
    return await runAsDemoSimulation(async () => {
      switch (action) {
        case 'homework': return await this.simulateHomework()
        case 'student_application': return await this.simulateStudentApplication()
        case 'teacher_application': return await this.simulateTeacherApplication()
        case 'chat_message': return await this.simulateChatMessage()
        case 'profile_edit': return await this.simulateProfileEdit()
      }
    })
  }

  private async principal(maxUserId: number): Promise<AuthenticatedPrincipal> {
    return { provider: 'web-session', claimedMaxUserId: maxUserId, user: await this.users.findByMaxUserId(maxUserId) }
  }

  private async nextDemoMaxUserId(): Promise<number> {
    const last = await this.prisma.users.findFirst({
      where: { max_user_id: { gte: BigInt(DEMO_ID_BASE) } },
      orderBy: { max_user_id: 'desc' },
      select: { max_user_id: true },
    })
    return Math.max(Number(last?.max_user_id ?? 0) + 1, DEMO_ID_BASE + 1000)
  }

  /** Случайный обучающийся демо-ученик с преподавателем (чтобы работу было кому проверить). */
  private async randomStudent() {
    const students = await this.prisma.students.findMany({
      where: {
        status: 'studying',
        users: { max_user_id: { gte: BigInt(DEMO_ID_BASE) } },
        student_teachers: { some: {} },
      },
      select: {
        id: true, full_name: true, phone: true, metro: true, lessons_count: true,
        users: { select: { max_user_id: true } },
        homeworks: { select: { lesson_number: true, status: true } },
      },
    })
    if (!students.length) throw fail(HttpStatus.CONFLICT, 'Нет обучающихся демо-учеников с преподавателем.')
    return students[Math.floor(Math.random() * students.length)]!
  }

  private async simulateHomework(): Promise<string> {
    const student = await this.randomStudent()
    const used = new Set(student.homeworks.filter((h) => h.status !== 'rejected').map((h) => h.lesson_number))
    const lesson = Array.from({ length: student.lessons_count }, (_, i) => i + 1).find((n) => !used.has(n)) ?? null
    const photos = Math.random() < 0.35 ? 2 : 1
    const files = []
    for (let i = 0; i < photos; i += 1) {
      files.push(await this.homeworkStorage.stage(Readable.from(await demoWorkPhoto()), `work-${i + 1}.jpg`, 'image/jpeg'))
    }
    const haircut = pick(HAIRCUTS)
    await this.submitHomework.execute(await this.principal(Number(student.users.max_user_id)), {
      fields: lesson == null
        ? { is_bonus: 'true', haircut_name: haircut, text_content: pick(STUDENT_NOTES) }
        : { lesson_number: String(lesson), haircut_name: haircut, text_content: pick(STUDENT_NOTES) },
      files,
    })
    return `${student.full_name} сдал(а) работу «${haircut}» по ${lesson == null ? 'дополнительному заданию' : `уроку №${lesson}`}.`
  }

  private async simulateStudentApplication(): Promise<string> {
    const person = randomPerson()
    const maxUserId = await this.nextDemoMaxUserId()
    await this.registerStudent.execute(
      { provider: 'web-session', claimedMaxUserId: maxUserId, user: null },
      { fullName: person.fullName, phone: randomPhone(), lessonsCount: pick([8, 10, 12, 16]), username: null, firstName: person.firstName, lastName: person.lastName, metro: pick(METRO) },
    )
    return `Новая заявка ученика: ${person.fullName}. Она ждёт модерации у администратора.`
  }

  private async simulateTeacherApplication(): Promise<string> {
    const person = randomPerson()
    const maxUserId = await this.nextDemoMaxUserId()
    await this.teacherApplication.execute(
      { provider: 'web-session', claimedMaxUserId: maxUserId, user: null },
      { fullName: person.fullName, phone: randomPhone() },
    )
    return `Заявка на роль преподавателя: ${person.fullName}.`
  }

  private async simulateChatMessage(): Promise<string> {
    const student = await this.randomStudent()
    await this.sendChatMessage.execute(await this.principal(Number(student.users.max_user_id)), {
      studentId: student.id,
      textContent: pick(CHAT_MESSAGES),
      attachment: null,
    })
    return `${student.full_name} написал(а) в чат команды.`
  }

  private async simulateProfileEdit(): Promise<string> {
    const student = await this.randomStudent()
    await this.profileEdit.execute(await this.principal(Number(student.users.max_user_id)), {
      fullName: student.full_name,
      phone: randomPhone(),
      metro: pick(METRO.filter((m) => m !== student.metro)),
    })
    return `${student.full_name} запросил(а) изменение телефона и метро в профиле.`
  }
}
