export type ChatStudent = {
  id: number
  fullName: string
  status: string
  /** Преподаватели ученика — участники чата. */
  teacherNames: string[]
  lastMessage: ChatMessageRecord | null
}

export type ChatStudentAccess = {
  ownerUserId: number
  isAssignedTeacher: boolean
}

export type ChatMessageTarget = ChatStudentAccess & {
  studentId: number
  studentUserId: number
  studentFullName: string
  senderStudentId: number | null
  assignedTeacherUserIds: number[]
}

export type CreateChatMessageCommand = {
  studentId: number
  senderUserId: number
  textContent: string | null
  contentType: string
  fileId: string | null
  notifications: Array<{ userId: number; body: string }>
}

export type ChatMessageRecord = {
  id: number
  studentId: number
  threadStudentUserId: number
  senderUserId: number
  senderMaxUserId: number
  senderFirstName: string | null
  senderLastName: string | null
  senderUsername: string | null
  senderRoles: string[]
  textContent: string | null
  contentType: string
  fileId: string | null
  createdAt: string
}

export abstract class ChatRepository {
  abstract findOwnStudent(userId: number): Promise<ChatStudent | null>
  abstract listActiveStudents(): Promise<ChatStudent[]>
  abstract listAssignedActiveStudents(teacherUserId: number): Promise<ChatStudent[]>
  abstract findStudentAccess(
    studentId: number,
    principalUserId: number,
  ): Promise<ChatStudentAccess | null>
  abstract listMessages(studentId: number, limit: number): Promise<ChatMessageRecord[]>
  abstract findMessage(messageId: number): Promise<ChatMessageRecord | null>
  abstract findMessageTarget(
    studentId: number,
    senderUserId: number,
  ): Promise<ChatMessageTarget | null>
  abstract createMessage(command: CreateChatMessageCommand): Promise<ChatMessageRecord>
  /** Непрочитанные пользователем чужие сообщения по чатам: student_id → количество. */
  abstract unreadCounts(userId: number): Promise<Map<number, number>>
  /** Отмечает чат прочитанным до последнего сообщения. */
  abstract markRead(userId: number, studentId: number, now: string): Promise<void>
}
