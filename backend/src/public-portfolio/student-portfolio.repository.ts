export type PublicTeacher = {
  id: number
  fullName: string
}

export type PublicHomeworkAttachment = {
  hasFile: boolean
  id: number
  contentType: string
}

export type PublicHomework = {
  hasFile: boolean
  id: number
  lessonNumber: number | null
  isBonus: boolean
  haircutName: string | null
  status: string
  contentType: string
  textContent: string | null
  createdAt: string
  rating: number | null
  reviewComment: string | null
  reviewerName: string | null
  attachments: PublicHomeworkAttachment[]
}

export type PublicStudentPortfolio = {
  student: {
    id: number
    fullName: string
    lessonsCount: number
    studentTrack: string
    metro: string | null
    aboutMe: string
    averageRating: number | null
    ratingsCount: number
    hasAvatar: boolean
    teachers: PublicTeacher[]
  }
  homeworks: PublicHomework[]
}

export abstract class StudentPortfolioRepository {
  abstract findVisibleByStudentId(studentId: number): Promise<PublicStudentPortfolio | null>
}
