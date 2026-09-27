import { useState } from 'react'
import { useApp } from '../../app/store'
import { cardButtonProps } from '../../ui/a11y'
import { useChatThreads, type ChatThread } from './api'

const preview = (thread: ChatThread): string => {
  const m = thread.last_message
  if (!m) return 'Сообщений пока нет'
  const text = m.text_content || (m.has_file ? 'Файл' : '')
  return `${m.sender_name ? `${m.sender_name}: ` : ''}${text}`
}

/** Список чатов для администратора и преподавателя: с кем чат, кто в нём и последнее сообщение. */
export function ChatsList() {
  const isAdmin = useApp((s) => Boolean(s.session?.isAdmin))
  const query = useChatThreads()
  const open = (thread: ChatThread) => {
    useApp.getState().patch({ selectedStudent: { id: thread.id, full_name: thread.full_name, teachers: thread.teachers ?? [] } })
    useApp.getState().go(isAdmin ? 'admin-chat' : 'teacher-chat')
  }
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  if (query.isPending) return <p className="empty">Загрузка…</p>
  if (query.isError) return <p className="empty">{query.error.message || 'Ошибка'}</p>
  if (!query.data.length) return <p className="empty">Чатов пока нет</p>
  // Поиск по ученику, преподавателям и последнему сообщению.
  const needle = search.trim().toLowerCase()
  const visible = query.data.filter((thread) => {
    if (unreadOnly && !Number(thread.unread_count || 0)) return false
    if (!needle) return true
    return [thread.full_name, ...(thread.teachers ?? []), preview(thread)].some((part) => part.toLowerCase().includes(needle))
  })
  const unreadTotal = query.data.filter((t) => Number(t.unread_count || 0) > 0).length
  return (
    <>
      <input
        className="inp"
        type="search"
        placeholder="Поиск: ученик, преподаватель, сообщение"
        aria-label="Поиск по чатам"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" className={unreadOnly ? 'btn bs' : 'btn bf bs'} onClick={() => setUnreadOnly(false)}>
          {`Все · ${query.data.length}`}
        </button>
        <button type="button" className={unreadOnly ? 'btn bf bs' : 'btn bs'} onClick={() => setUnreadOnly(true)}>
          {`Непрочитанные · ${unreadTotal}`}
        </button>
      </div>
      {!visible.length && <p className="empty">{unreadOnly && !needle ? 'Непрочитанных нет' : 'Ничего не найдено'}</p>}
      {visible.map((thread) => (
        <div key={thread.id} className="card" style={{ marginBottom: 10, cursor: 'pointer' }} {...cardButtonProps(() => open(thread))}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              {thread.full_name}
              {Number(thread.unread_count || 0) > 0 && (
                <span
                  aria-label={`Непрочитанных: ${thread.unread_count}`}
                  style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: 'var(--gold)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {thread.unread_count}
                </span>
              )}
            </div>
            {thread.last_message && (
              <div style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
                {String(thread.last_message.created_at || '').slice(5, 16).replace('T', ' ')}
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--dim)', fontFamily: 'var(--font-body)', marginTop: 3 }}>
            {thread.teachers?.length ? `Преподаватели: ${thread.teachers.join(', ')}` : 'Преподаватель не назначен'}
          </div>
          <div
            style={{
              fontSize: 13,
              fontFamily: 'var(--font-body)',
              marginTop: 6,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: thread.last_message ? 'var(--text)' : 'var(--dim)',
              fontWeight: Number(thread.unread_count || 0) > 0 ? 700 : 400,
            }}
          >
            {preview(thread)}
          </div>
        </div>
      ))}
    </>
  )
}
