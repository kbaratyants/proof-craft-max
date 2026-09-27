export type AnalyticsTeacher = {
  teacherId: number
  userId: number
  maxUserId: number
  fullName: string
  studentsCount: number
  pendingCreatedAt: string[]
}

export type AnalyticsReview = { teacherId: number; reviewedAt: string; submittedAt: string }

export type AnalyticsStudent = {
  studentId: number
  fullName: string
  createdAt: string
  lastSubmittedAt: string | null
  pendingCount: number
  revisionCount: number
}

export type AnalyticsSnapshot = {
  teachers: AnalyticsTeacher[]
  /** Проверки за последние 30 дней с датой сдачи работы. */
  reviews: AnalyticsReview[]
  students: AnalyticsStudent[]
  /** Даты за последние 14 дней: сданные работы, проверки, заявки учеников и преподавателей. */
  submittedAt: string[]
  reviewedAt: string[]
  applicationsAt: string[]
}

export abstract class AdminAnalyticsRepository {
  abstract snapshot(since30: string, since14: string): Promise<AnalyticsSnapshot>
}
