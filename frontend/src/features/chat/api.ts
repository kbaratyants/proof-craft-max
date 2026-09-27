import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost, apiUrl } from '../../api/client'
import { multipartHeaders } from '../../api/files'
import { useApp } from '../../app/store'

export type ChatMessage = {
  id: number
  sender_user_id: number
  sender_name: string | null
  sender_role: string | null
  sender_role_color: string | null
  text_content: string | null
  has_file: boolean
  created_at: string
}

export const chatQueryKey = (studentId: string) => ['chat', studentId]

export function useChatMessages(studentId: string | null) {
  const platform = useApp((s) => s.platform)
  const appUserId = useApp((s) => s.appUserId)
  return useQuery({
    queryKey: chatQueryKey(String(studentId)),
    enabled: studentId != null,
    refetchOnMount: 'always',
    queryFn: async () =>
      (
        await apiGet<{ messages?: ChatMessage[] }>(
          platform,
          `/api/chats/messages?max_user_id=${encodeURIComponent(String(appUserId))}&student_id=${encodeURIComponent(String(studentId))}&limit=200`,
        )
      ).messages ?? [],
  })
}

/** Отправка текста в чат ученика (multipart). */
export async function sendChatMessage(studentId: string, text: string) {
  const form = new FormData()
  form.append('max_user_id', String(useApp.getState().appUserId))
  form.append('student_id', studentId)
  form.append('text_content', text)
  const response = await fetch(apiUrl('/api/chats/messages'), { method: 'POST', cache: 'no-store', headers: multipartHeaders(), body: form })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `Ошибка запроса (${response.status}).`)
}

export type ChatThread = {
  id: number
  full_name: string
  status: string
  teachers?: string[]
  last_message?: ChatMessage | null
  unread_count?: number
}

/** Чаты, доступные пользователю: админу — все, преподавателю — его учеников, ученику — свой. */
export function useChatThreads() {
  const platform = useApp((s) => s.platform)
  const appUserId = useApp((s) => s.appUserId)
  return useQuery({
    queryKey: ['chat-threads'],
    refetchOnMount: 'always',
    queryFn: async () =>
      (await apiGet<{ students?: ChatThread[] }>(platform, `/api/chats/students?max_user_id=${encodeURIComponent(String(appUserId))}`)).students ?? [],
  })
}

/** Отмечает чат прочитанным и обновляет счётчики непрочитанных. */
export async function markChatRead(studentId: string) {
  const { platform, appUserId } = useApp.getState()
  await apiPost(platform, '/api/chats/read', { max_user_id: appUserId, student_id: Number(studentId) })
}

/** Сумма непрочитанных по всем доступным чатам — для бейджа на вкладке. */
export function useUnreadChats(): number {
  const threads = useChatThreads()
  return (threads.data ?? []).reduce((sum, t) => sum + Number(t.unread_count || 0), 0)
}
