import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { UserNotificationGateway } from '../notifications/user-notification.gateway.js'
import { FileReferenceService } from '../storage/file-reference.service.js'
import {
  HomeworkSubmissionStorage,
  type FinalHomeworkFile,
  UnsupportedHomeworkImageError,
} from './homework-submission.storage.js'
import {
  StudentHomeworksRepository,
  type HomeworkSubmissionStudent,
  type SubmittedHomework,
} from './student-homeworks.repository.js'
import type { SubmitHomeworkCommand } from './submit-homework.request.js'

const duplicateError = (): HttpException => new HttpException(
  {
    ok: false,
    error: 'По этому уроку или бонусу уже есть работа на проверке. Дождитесь проверки преподавателя.',
  },
  HttpStatus.CONFLICT,
)

@Injectable()
export class SubmitHomeworkUseCase {
  constructor(
    @Inject(StudentHomeworksRepository)
    private readonly homeworks: StudentHomeworksRepository,
    @Inject(HomeworkSubmissionStorage)
    private readonly storage: HomeworkSubmissionStorage,
    @Inject(FileReferenceService)
    private readonly fileReferences: FileReferenceService,
    @Inject(UserNotificationGateway)
    private readonly notifications: UserNotificationGateway,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    command: SubmitHomeworkCommand,
  ): Promise<object> {
    const student = principal.user
      ? await this.homeworks.findSubmissionStudent(principal.user.id)
      : null
    if (!student) {
      throw new HttpException(
        { ok: false, error: 'Ученик не найден. Отправьте /start боту.' },
        HttpStatus.NOT_FOUND,
      )
    }
    if (student.status !== 'studying') {
      throw new HttpException(
        { ok: false, error: 'Сдача работ доступна только ученикам в статусе "обучается".' },
        HttpStatus.FORBIDDEN,
      )
    }

    const isBonus = this.isBonus(command.fields.is_bonus)
    const lessonNumber = command.fields.lesson_number
      ? Number(command.fields.lesson_number)
      : null
    if (!isBonus && (!Number.isInteger(lessonNumber) || Number(lessonNumber) <= 0)) {
      throw new HttpException(
        { ok: false, error: 'Укажите номер урока (целое число) или отметьте бонусную работу.' },
        HttpStatus.BAD_REQUEST,
      )
    }
    if (
      !isBonus &&
      student.lessonsCount != null &&
      Number(lessonNumber) > student.lessonsCount
    ) {
      throw new HttpException(
        {
          ok: false,
          error: `Урок №${lessonNumber} недоступен. По вашей программе ${student.lessonsCount} уроков.`,
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const textContent = String(command.fields.text_content ?? '').trim()
    const haircutName = String(command.fields.haircut_name ?? '').trim().slice(0, 200)
    if (command.files.length === 0 && !textContent) {
      throw new HttpException(
        { ok: false, error: 'Добавьте файл или текстовое описание работы.' },
        HttpStatus.BAD_REQUEST,
      )
    }

    const finalized: FinalHomeworkFile[] = []
    try {
      for (const file of command.files) {
        finalized.push(await this.storage.finalize(file))
      }
      if (
        finalized.length > 1 &&
        finalized.some((file) => !file.mimeType.toLowerCase().startsWith('image/'))
      ) {
        throw new HttpException(
          {
            ok: false,
            error: 'Несколько файлов за раз можно прикрепить только для фото. Видео или документ отправьте одним файлом (или добавьте текст к серии фото).',
          },
          HttpStatus.BAD_REQUEST,
        )
      }

      const normalizedLesson = isBonus ? null : Number(lessonNumber)
      if (await this.homeworks.hasPendingSubmission(student.id, normalizedLesson, isBonus)) {
        throw duplicateError()
      }
      const notification = this.notification(student, isBonus, normalizedLesson, haircutName)
      const teacherMaxUserIds = this.maxUserIds(student.teachers)
      const adminExtra =
        student.teachers.length === 0 || teacherMaxUserIds.length === 0
          ? '\n\n⚠️ Ученику не назначены преподаватели или у них нет ID в MAX — уведомление в чат преподавателям не ушло. Проверьте связку в админке.'
          : ''
      const result = await this.homeworks.createSubmission({
        studentId: student.id,
        lessonNumber: normalizedLesson,
        isBonus,
        haircutName: haircutName || null,
        textContent: textContent || null,
        files: finalized.map((file) => ({
          fileId: file.path,
          contentType: this.contentType(file.mimeType),
        })),
        teacherNotificationBody: notification,
        adminNotificationBody: notification + adminExtra,
        teacherUserIds: student.teachers.map(({ userId }) => userId),
        adminUserIds: student.admins.map(({ userId }) => userId),
      })
      if (result.kind === 'duplicate') throw duplicateError()

      await Promise.allSettled(
        teacherMaxUserIds.map((maxUserId) => this.notifications.send(maxUserId, notification)),
      )
      await Promise.allSettled(
        this.maxUserIds(student.admins).map((maxUserId) =>
          this.notifications.send(maxUserId, notification + adminExtra),
        ),
      )
      return { ok: true, data: { homework: this.response(result.homework) } }
    } catch (error) {
      await Promise.all(finalized.map((file) => this.storage.discard(file.path)))
      if (error instanceof HttpException) throw error
      if (error instanceof UnsupportedHomeworkImageError) {
        throw new HttpException(
          {
            ok: false,
            error: 'Формат HEIC/HEIF не поддерживается на сервере. Сохраните фото как JPG/JPEG и повторите.',
          },
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        )
      }
      throw new HttpException(
        { ok: false, error: 'Не удалось загрузить работу. Попробуйте позже.' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  private isBonus(value: string | undefined): boolean {
    const normalized = String(value ?? '').toLowerCase()
    return normalized === 'true' || value === '1' || normalized === 'on'
  }

  private contentType(mimeType: string): string {
    if (mimeType.startsWith('image/')) return 'photo'
    if (mimeType.startsWith('video/')) return 'video'
    return 'document'
  }

  private notification(
    student: HomeworkSubmissionStudent,
    isBonus: boolean,
    lessonNumber: number | null,
    haircutName: string,
  ): string {
    const lesson = isBonus ? 'дополнительное задание' : `урок №${lessonNumber}`
    const haircut = haircutName ? ` («${haircutName}»)` : ''
    return `Ученик ${student.fullName} отправил ДЗ по ${lesson}${haircut}.`
  }

  private maxUserIds(recipients: Array<{ maxUserId: number }>): number[] {
    return recipients
      .map(({ maxUserId }) => maxUserId)
      .filter((maxUserId) => Number.isInteger(maxUserId) && maxUserId > 0)
  }

  private response(homework: SubmittedHomework): object {
    const primary = this.fileReferences.hasFile(homework.fileId)
    return {
      id: homework.id,
      lesson_number: homework.lessonNumber,
      is_bonus: homework.isBonus,
      haircut_name: homework.haircutName,
      has_file: primary,
      status: homework.status,
      content_type: homework.contentType,
      text_content: homework.textContent,
      review_count: 0,
      created_at: homework.createdAt,
      extra_files_count: homework.attachments.length,
      attachments: homework.attachments.map((attachment) => {
        const availability = this.fileReferences.hasFile(attachment.fileId)
        return {
          id: attachment.id,
          content_type: attachment.contentType,
          has_file: availability,
        }
      }),
    }
  }
}
