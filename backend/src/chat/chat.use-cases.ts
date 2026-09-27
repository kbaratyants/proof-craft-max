import { Inject, Injectable } from '@nestjs/common'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import { ChatAccessPolicy } from './chat-access.policy.js'
import { mapChatMessage } from './chat-message.mapper.js'
import { ChatRepository } from './chat.repository.js'
import type { ChatMessagesQuery } from './chat.request.js'

@Injectable()
export class ListChatStudentsUseCase {
  constructor(
    @Inject(ChatRepository) private readonly chats: ChatRepository,
    @Inject(ChatAccessPolicy) private readonly access: ChatAccessPolicy,
  ) {}

  async execute(principal: AuthenticatedPrincipal): Promise<object> {
    const user = this.access.requireUser(principal)
    const unread = await this.chats.unreadCounts(user.id)
    const ownStudent = await this.chats.findOwnStudent(user.id)
    const students = ownStudent
      ? [ownStudent]
      : user.roles.includes('admin')
        ? await this.chats.listActiveStudents()
        : user.roles.includes('teacher')
          ? await this.chats.listAssignedActiveStudents(user.id)
          : []
    return {
      ok: true,
      data: {
        // Сначала чаты с последней активностью, затем по имени.
        students: [...students]
          .sort((a, b) => (b.lastMessage?.id ?? 0) - (a.lastMessage?.id ?? 0) || a.fullName.localeCompare(b.fullName, 'ru'))
          .map((student) => ({
            id: student.id,
            full_name: student.fullName,
            status: student.status,
            teachers: student.teacherNames,
            last_message: student.lastMessage ? mapChatMessage(student.lastMessage) : null,
            unread_count: unread.get(student.id) ?? 0,
          })),
      },
    }
  }
}

@Injectable()
export class ListChatMessagesUseCase {
  constructor(
    @Inject(ChatRepository) private readonly chats: ChatRepository,
    @Inject(ChatAccessPolicy) private readonly access: ChatAccessPolicy,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    query: ChatMessagesQuery,
  ): Promise<object> {
    const user = this.access.requireUser(principal)
    const studentAccess = await this.chats.findStudentAccess(query.studentId, user.id)
    this.access.assertStudentAccess(
      user,
      studentAccess,
      'Нет доступа к чату этого ученика.',
    )
    const messages = await this.chats.listMessages(query.studentId, query.limit)
    return { ok: true, data: { messages: messages.map(mapChatMessage) } }
  }
}

/** Отметка «прочитано»: с той же матрицей доступа, что и чтение сообщений. */
@Injectable()
export class MarkChatReadUseCase {
  constructor(
    @Inject(ChatRepository) private readonly chats: ChatRepository,
    @Inject(ChatAccessPolicy) private readonly access: ChatAccessPolicy,
  ) {}

  async execute(principal: AuthenticatedPrincipal, studentId: number): Promise<{ ok: true }> {
    const user = this.access.requireUser(principal)
    const studentAccess = await this.chats.findStudentAccess(studentId, user.id)
    this.access.assertStudentAccess(user, studentAccess, 'Нет доступа к чату этого ученика.')
    await this.chats.markRead(user.id, studentId, sqliteTimestamp())
    return { ok: true }
  }
}
