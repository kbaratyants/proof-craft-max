import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '../../api/client'
import { useApp } from '../../app/store'
import { homeworkTitle, type HomeworkBase } from '../../domain/homework'
import { Header } from '../../ui/Header'
import { toast } from '../../ui/toast'
import type { StudentHomework } from '../student/api'
import { fetchAdminStudentProfile, useAdminStudents } from './api'
import { openAdminStudent } from './actions'

type PendingWork = HomeworkBase & { id: number; student_id: number; student_name?: string; created_at: string }

const withUser = () => `max_user_id=${encodeURIComponent(String(useApp.getState().appUserId))}`

const waitingDays = (createdAt: string): number => {
  const created = Date.parse(`${createdAt.replace(' ', 'T')}Z`)
  return Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86_400_000)) : 0
}

const daysLabel = (days: number): string => {
  if (days === 0) return 'сдано сегодня'
  const mod10 = days % 10
  const mod100 = days % 100
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней'
  return `ждёт ${days} ${word}`
}

async function openWork(work: PendingWork) {
  try {
    const profile = await fetchAdminStudentProfile(work.student_id)
    const homework = profile.homeworks.find((h) => h.id === work.id)
    if (!homework) throw new Error('Работа не найдена')
    useApp.getState().patch({ adminStudentId: work.student_id, teacherStudentId: null })
    useApp.getState().go('hw-view', { homework: homework as StudentHomework })
  } catch (error) {
    toast(error instanceof Error && error.message ? error.message : 'Не удалось открыть работу', 'error')
  }
}

function WorkRow({ work, teachers }: { work: PendingWork; teachers: string[] }) {
  const [reminded, setReminded] = useState(false)
  const [busy, setBusy] = useState(false)
  const days = waitingDays(work.created_at)
  const remind = async () => {
    setBusy(true)
    try {
      const { platform, appUserId } = useApp.getState()
      const data = await apiPost<{ notified: string[] }>(platform, `/api/admin/homeworks/${work.id}/remind`, { max_user_id: appUserId })
      toast(`Напоминание отправлено: ${data.notified.join(', ')}`, 'success')
      setReminded(true)
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : 'Не удалось отправить напоминание', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <button
          type="button"
          onClick={() => openAdminStudent(work.student_id)}
          style={{ background: 'none', border: 'none', padding: 0, fontWeight: 700, fontSize: 14, color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}
        >
          {work.student_name || 'Ученик'}
        </button>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-body)', color: days >= 3 ? 'var(--danger)' : 'var(--warn, var(--gold))', flexShrink: 0 }}>
          {daysLabel(days)}
        </span>
      </div>
      <div style={{ fontSize: 13, fontFamily: 'var(--font-body)', marginTop: 4 }}>{homeworkTitle(work)}</div>
      <div style={{ fontSize: 12, color: 'var(--dim)', fontFamily: 'var(--font-body)', marginTop: 3 }}>
        {teachers.length ? `Проверяет: ${teachers.join(', ')}` : 'Преподаватель не назначен'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn bs" style={{ flex: 1 }} onClick={() => void openWork(work)}>
          Открыть работу
        </button>
        {teachers.length ? (
          <button type="button" className="btn bf bs" style={{ flex: 1 }} disabled={busy || reminded} onClick={() => void remind()}>
            {reminded ? 'Напомнили ✓' : busy ? 'Отправляем…' : 'Напомнить'}
          </button>
        ) : (
          <button type="button" className="btn bf bs" style={{ flex: 1 }} onClick={() => openAdminStudent(work.student_id)}>
            Назначить
          </button>
        )}
      </div>
    </div>
  )
}

/** Все работы на проверке по академии: кто сдал, кто проверяет, сколько ждёт; напоминание преподавателю. */
export function AdminPendingWorksScreen() {
  const works = useQuery({
    queryKey: ['admin', 'pending-works'],
    refetchOnMount: 'always',
    queryFn: async () =>
      ((await apiGet<{ homeworks?: PendingWork[] }>(useApp.getState().platform, `/api/admin/homeworks?${withUser()}`)).homeworks ?? [])
        .filter((h) => h.status === 'pending')
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
  })
  const students = useAdminStudents({ refetchOnMount: false })
  const teachersOf = new Map((students.data ?? []).map((s) => [s.id, (s.teachers || []).map((t) => t.full_name)]))
  let body
  if (works.isPending) body = <p className="empty">Загрузка…</p>
  else if (works.isError) body = <p className="empty">{works.error.message || 'Ошибка'}</p>
  else if (!works.data.length) body = <p className="empty">Все работы проверены</p>
  else
    body = (
      <>
        <p style={{ color: 'var(--dim)', fontFamily: 'var(--font-body)', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          {`Ожидают проверки · ${works.data.length} · сначала самые старые`}
        </p>
        {works.data.map((w) => (
          <WorkRow key={w.id} work={w} teachers={teachersOf.get(w.student_id) ?? []} />
        ))}
      </>
    )
  return (
    <>
      <Header title="На проверке" onBack={() => useApp.getState().back()} />
      <div className="scr fi" style={{ padding: 12 }}>
        {body}
      </div>
    </>
  )
}
