export type SaveTeacherApplication = {
  existingUserId: number | null
  claimedMaxUserId: number
  firstName: string
  lastName: string | null
  fullName: string
  phone: string
  adminMessage: string
  createdAt: string
}

export type SavedTeacherApplication = {
  adminMaxUserIds: number[]
}

export type RegistrationStudent = {
  id: number
  user_id: number
  full_name: string
  phone: string
  lessons_count: number
  status: string
  created_at: string
  updated_at: string
  student_track: string
  metro: string | null
  avatar_file_id: string | null
  about_me: string | null
  max_user_id: number
  username: string | null
  first_name: string | null
  last_name: string | null
}

export type SaveStudentRegistration = {
  existingUserId: number | null
  claimedMaxUserId: number
  username: string | null
  firstName: string
  lastName: string | null
  fullName: string
  phone: string
  lessonsCount: number
  metro: string | null
  adminMessage: string
  createdAt: string
}

export type SavedStudentRegistration = {
  student: RegistrationStudent
  roles: string[]
  adminMaxUserIds: number[]
}

export abstract class RegistrationRepository {
  abstract saveTeacherApplication(
    command: SaveTeacherApplication,
  ): Promise<SavedTeacherApplication>

  abstract findStudentByUserId(userId: number): Promise<RegistrationStudent | null>
  abstract saveStudentRegistration(
    command: SaveStudentRegistration,
  ): Promise<SavedStudentRegistration>
  abstract saveStudentFeedback(
    userId: number,
    requestKey: string,
    subject: string,
    message: string,
    createdAt: string,
  ): Promise<boolean>
}
