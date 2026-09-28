import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiGet, apiPost } from '../../api/client'
import { useApp } from '../../app/store'
import { cardButtonProps } from '../../ui/a11y'
import { Header } from '../../ui/Header'
import { toast } from '../../ui/toast'
import { openAdminStudent } from './actions'

type TeacherLoad = {
  teacher_id: number
  full_name: string
  students_count: number
  pending_count: number
  oldest_pending_days: number | null
  avg_review_hours: number | null
  reviewed_7d: number
}
type AtRisk = { student_id: number; full_name: string; idle_days: number; pending_count: number; reasons: string[] }
type Week = { submitted: number; reviewed: number; applications: number }
type Analytics = { teachers: TeacherLoad[]; at_risk: AtRisk[]; activity: { this_week: Week; previous_week: Week }; inactive_days_threshold: number }

const analyticsKey = ['admin', 'analytics']
const sectionTitle = { fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--gold)', margin: '4px 0 10px' } as const
const muted = { fontSize: 12, color: 'var(--dim)', fontFamily: 'var(--font-body)' } as const

const reviewTime = (hours: number | null): string => {
  if (hours == null) return '—'
  if (hours < 24) return `${Math.max(1, Math.round(hours))} ч`
  return `${Math.round((hours / 24) * 10) / 10} дн.`
}

function Delta({ now, before }: { now: number; before: number }) {
  if (now === before) return <span style={muted}>{`= было ${before}`}</span>
  const up = now > before
  return <span style={{ ...muted, color: up ? 'var(--success)' : 'var(--danger)' }}>{`${up ? '▲ +' : '▼ −'}${Math.abs(now - before)} · было ${before}`}</span>
}

function ActivityTile({ label, now, before }: { label: string; now: number; before: number }) {
  return (
    <div className="card" style={{ padding: 12, marginBottom: 0 }}>
      <div style={{ ...muted, textTransform: 'uppercase', letterSpacing: '.6px' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, lineHeight: 1.2 }}>{now}</div>
      <Delta now={now} before={before} />
    </div>
  )
}

function TeacherRow({ t }: { t: TeacherLoad }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const remind = async () => {
    setBusy(true)
    try {
      const { platform, appUserId } = useApp.getState()
      await apiPost(platform, `/api/admin/teachers/${t.teacher_id}/remind`, { max_user_id: appUserId })
      toast(`Напоминание отправлено: ${t.full_name}`, 'success')
      setDone(true)
      await queryClient.invalidateQueries({ queryKey: analyticsKey })
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : 'Не удалось отправить напоминание', 'error')
    } finally {
      setBusy(false)
    }
  }
  const late = (t.oldest_pending_days ?? 0) >= 3
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{t.full_name}</div>
        <div style={{ ...muted, flexShrink: 0 }}>{`учеников: ${t.students_count}`}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
        <div>
          <div style={muted}>На проверке</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: t.pending_count ? 'var(--warn, var(--gold))' : 'inherit' }}>{t.pending_count}</div>
        </div>
        <div>
          <div style={muted}>Ждёт дольше всех</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: late ? 'var(--danger)' : 'inherit' }}>
            {t.oldest_pending_days == null ? '—' : `${t.oldest_pending_days} дн.`}
          </div>
        </div>
        <div>
          <div style={muted}>Проверка в среднем</div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{reviewTime(t.avg_review_hours)}</div>
        </div>
      </div>
      <div style={{ ...muted, marginTop: 6 }}>{`Проверено за 7 дней: ${t.reviewed_7d}`}</div>
      {t.pending_count > 0 && (
        <button type="button" className="btn bf bs btn-w" style={{ marginTop: 10 }} disabled={busy || done} onClick={() => void remind()}>
          {done ? 'Напомнили ✓' : busy ? 'Отправляем…' : `Напомнить (${t.pending_count})`}
        </button>
      )}
    </div>
  )
}

/** Аналитика академии: нагрузка преподавателей, отстающие ученики и активность за неделю. */
export function AdminAnalyticsScreen() {
  const query = useQuery({
    queryKey: analyticsKey,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { platform, appUserId } = useApp.getState()
      return await apiGet<Analytics>(platform, `/api/admin/analytics?max_user_id=${encodeURIComponent(String(appUserId))}`)
    },
  })
  let body
  if (query.isPending) body = <p className="empty">Загрузка…</p>
  else if (query.isError) body = <p className="empty">{query.error.message || 'Ошибка'}</p>
  else {
    const { teachers, at_risk: atRisk, activity, inactive_days_threshold: threshold } = query.data
    body = (
      <>
        <div style={sectionTitle}>Активность за 7 дней</div>
        <p style={{ ...muted, margin: '-4px 0 10px' }}>В сравнении с предыдущими 7 днями</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 18 }}>
          <ActivityTile label="Сдано" now={activity.this_week.submitted} before={activity.previous_week.submitted} />
          <ActivityTile label="Проверено" now={activity.this_week.reviewed} before={activity.previous_week.reviewed} />
          <ActivityTile label="Заявки" now={activity.this_week.applications} before={activity.previous_week.applications} />
        </div>

        <div style={sectionTitle}>Нагрузка преподавателей</div>
        {teachers.length ? teachers.map((t) => <TeacherRow key={t.teacher_id} t={t} />) : <p className="empty">Преподавателей нет</p>}

        <div style={{ ...sectionTitle, marginTop: 18 }}>{`Отстающие ученики · ${atRisk.length}`}</div>
        <p style={{ ...muted, margin: '-4px 0 10px' }}>{`Не сдавали работ дольше ${threshold} дней или есть работы на доработке`}</p>
        {atRisk.length ? (
          atRisk.map((s) => (
            <div key={s.student_id} className="card" style={{ marginBottom: 10, cursor: 'pointer' }} {...cardButtonProps(() => openAdminStudent(s.student_id))}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{`${s.full_name} ›`}</div>
              <div style={{ fontSize: 13, fontFamily: 'var(--font-body)', marginTop: 4, color: 'var(--danger)' }}>{s.reasons.join(' · ')}</div>
              {s.pending_count > 0 && <div style={{ ...muted, marginTop: 3 }}>{`Работ на проверке: ${s.pending_count}`}</div>}
            </div>
          ))
        ) : (
          <p className="empty">Все ученики активны</p>
        )}
      </>
    )
  }
  return (
    <>
      <Header title="Аналитика" onBack={() => useApp.getState().back()} />
      <div className="scr fi" style={{ padding: 12 }}>
        {body}
      </div>
    </>
  )
}
