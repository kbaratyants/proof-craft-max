import { useApp } from '../../app/store'
import { Header } from '../../ui/Header'
import { useChatThreads } from './api'
import { ChatPanel } from './ChatPanel'
import { ChatParticipants } from './ChatParticipants'

/** Чат преподавателя или администратора с учеником. */
export function StaffChatScreen() {
  const selected = useApp((s) => s.selectedStudent as { id?: number; full_name?: string; teachers?: string[] } | null)
  const threads = useChatThreads()
  const name = selected?.full_name?.trim()
  // Участники берутся из списка чатов, даже если чат открыт из карточки ученика.
  const teachers = selected?.teachers ?? threads.data?.find((t) => t.id === selected?.id)?.teachers ?? null
  return (
    <>
      <Header title={name ? `Чат · ${name}` : 'Чат'} onBack={() => useApp.getState().back()} />
      <div className="scr fi" style={{ padding: 0 }}>
        <ChatPanel header={<ChatParticipants student={name} teachers={teachers} />} />
      </div>
    </>
  )
}
