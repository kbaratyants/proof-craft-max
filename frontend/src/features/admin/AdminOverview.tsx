import { useApp } from '../../app/store'
import { useAdminStudents } from './api'

const tile = { padding: '10px 12px', borderRadius: 16, background: 'var(--card-bg, rgba(201,162,39,.06))', border: '1px solid var(--border)' } as const
const label = { fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '.6px' } as const
const value = { fontFamily: 'var(--font-display)', fontSize: 24, lineHeight: 1.2, marginTop: 2 } as const

/** Сводка академии для администратора: сколько работ ждёт проверки и где нужна помощь. */
export function AdminOverview() {
  const students = useAdminStudents({ refetchOnMount: false })
  if (!students.isSuccess) return null
  const studying = students.data.filter((s) => s.status === 'studying')
  const pendingWorks = students.data.reduce((sum, s) => sum + Number(s.pending_homeworks_count || 0), 0)
  const waitingStudents = students.data.filter((s) => Number(s.pending_homeworks_count || 0) > 0).length
  const withoutTeacher = studying.filter((s) => s.student_track !== 'barber' && !(s.teachers || []).length).length
  const rated = students.data.filter((s) => s.average_rating != null)
  const avg = rated.length ? (rated.reduce((sum, s) => sum + Number(s.average_rating), 0) / rated.length).toFixed(2) : '—'
  return (
    <section className="card" style={{ padding: 14, marginBottom: 14 }} aria-label="Сводка академии">
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--gold)', marginBottom: 10 }}>Сводка академии</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button type="button" onClick={() => useApp.getState().go('admin-pending-works')} style={{ ...tile, textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
          <div style={label}>На проверке ›</div>
          <div style={{ ...value, color: pendingWorks ? 'var(--warn, var(--gold))' : 'inherit' }}>{pendingWorks}</div>
          <div style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-body)' }}>{`у ${waitingStudents} учеников`}</div>
        </button>
        <div style={tile}>
          <div style={label}>Обучаются</div>
          <div style={value}>{studying.length}</div>
        </div>
        <button type="button" onClick={() => useApp.getState().go('admin-unassigned')} style={{ ...tile, textAlign: 'left', cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
          <div style={label}>Без преподавателя ›</div>
          <div style={{ ...value, color: withoutTeacher ? 'var(--danger)' : 'inherit' }}>{withoutTeacher}</div>
        </button>
        <div style={tile}>
          <div style={label}>Средний балл</div>
          <div style={value}>{avg}</div>
        </div>
      </div>
      <button type="button" className="btn bs btn-w" style={{ marginTop: 10 }} onClick={() => useApp.getState().go('admin-analytics')}>
        Вся аналитика: нагрузка, отстающие, активность ›
      </button>
    </section>
  )
}
