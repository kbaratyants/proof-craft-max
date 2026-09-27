export type PendingHomeworkForReminder = {
  homeworkId: number
  studentId: number
  studentName: string
  lessonNumber: number | null
  isBonus: boolean
  haircutName: string | null
  createdAt: string
  teachers: Array<{ userId: number; maxUserId: number; fullName: string }>
}

export type SaveHomeworkReminder = {
  actorUserId: number
  homeworkId: number
  studentId: number
  teacherUserIds: number[]
  body: string
  now: string
}

export abstract class AdminHomeworkReminderRepository {
  /** Работа на проверке и активные преподаватели её ученика; null, если работы нет или она уже проверена. */
  abstract findPendingHomework(homeworkId: number): Promise<PendingHomeworkForReminder | null>
  /** In-app уведомления преподавателям и запись в аудит — одной транзакцией. */
  abstract saveReminder(command: SaveHomeworkReminder): Promise<void>
  /** Общее напоминание преподавателю об очереди проверки. */
  abstract saveTeacherReminder(command: { actorUserId: number; teacherUserId: number; body: string; now: string }): Promise<void>
}
