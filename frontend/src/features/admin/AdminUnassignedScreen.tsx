import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiPost } from '../../api/client'
import { refreshSessionQuiet } from '../../app/session'
import { useApp } from '../../app/store'
import { Header } from '../../ui/Header'
import { toast } from '../../ui/toast'
import { openAdminStudent } from './actions'
import { adminKeys, useAdminStudents, useAdminTeachers, type AdminStudent, type AdminTeacher } from './api'

function UnassignedRow({ student, teachers }: { student: AdminStudent; teachers: AdminTeacher[] }) {
  const queryClient = useQueryClient()
  const [teacherId, setTeacherId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const assign = async () => {
    if (!teacherId) return
    setBusy(true)
    try {
      const { platform, appUserId } = useApp.getState()
      await apiPost(platform, '/api/admin/assign-student', { max_user_id: appUserId, teacher_id: teacherId, student_id: student.id })
      toast(`${student.full_name}: назначен преподаватель ${teachers.find((t) => t.id === teacherId)?.full_name ?? ''}`, 'success')
      await queryClient.invalidateQueries({ queryKey: adminKeys.students() })
      await queryClient.invalidateQueries({ queryKey: adminKeys.teachers() })
      await refreshSessionQuiet()
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : 'Не удалось назначить преподавателя', 'error')
      setBusy(false)
    }
  }
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={() => openAdminStudent(student.id)}
        style={{ background: 'none', border: 'none', padding: 0, fontWeight: 700, fontSize: 14, color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}
      >
        {student.full_name} ›
      </button>
      <div style={{ fontSize: 12, color: 'var(--dim)', fontFamily: 'var(--font-body)', marginTop: 3 }}>
        {`Работ на проверке: ${Number(student.pending_homeworks_count || 0)}`}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <select
          className="inp"
          aria-label={`Преподаватель для ${student.full_name}`}
          value={teacherId}
          onChange={(event) => setTeacherId(event.target.value ? Number(event.target.value) : '')}
          style={{ flex: 1, marginBottom: 0 }}
        >
          <option value="">Выберите преподавателя</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {`${t.full_name}${t.students_count != null ? ` · учеников: ${t.students_count}` : ''}`}
            </option>
          ))}
        </select>
        <button type="button" className="btn bf bs" disabled={!teacherId || busy} onClick={() => void assign()}>
          {busy ? '…' : 'Назначить'}
        </button>
      </div>
    </div>
  )
}

/** Обучающиеся ученики без преподавателя: назначение прямо из списка. */
export function AdminUnassignedScreen() {
  const students = useAdminStudents()
  const teachers = useAdminTeachers()
  const list = (students.data ?? []).filter((s) => s.status === 'studying' && s.student_track !== 'barber' && !(s.teachers || []).length)
  return (
    <>
      <Header title="Без преподавателя" onBack={() => useApp.getState().back()} />
      <div className="scr fi" style={{ padding: 12 }}>
        {students.isPending ? (
          <p className="empty">Загрузка…</p>
        ) : !list.length ? (
          <p className="empty">У всех учеников есть преподаватель</p>
        ) : (
          list.map((s) => <UnassignedRow key={s.id} student={s} teachers={teachers.data ?? []} />)
        )}
      </div>
    </>
  )
}
