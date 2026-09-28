import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '../../ui/toast'
import { DEMO_ROLE_LABELS, type DemoRole, demoLogin, fetchDemoConfig } from './api'

export const useDemoConfig = () => useQuery({ queryKey: ['demo-config'], queryFn: fetchDemoConfig, staleTime: Infinity })

/** Кнопки входа в демо-академию по ролям. Ничего не показывает, если на сервере выключен DEMO_MODE. */
export function DemoAccess({ disabled = false, framed = true }: { disabled?: boolean; framed?: boolean }) {
  const config = useDemoConfig()
  const [busy, setBusy] = useState<DemoRole | null>(null)
  if (!config.data?.enabled) return null
  const enter = async (role: DemoRole) => {
    setBusy(role)
    try {
      await demoLogin(role)
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : 'Не удалось войти в демо', 'error')
      setBusy(null)
    }
  }
  const buttons = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {config.data.roles.map((role) => (
        <button key={role} type="button" className="btn bs btn-w" disabled={disabled || busy != null} onClick={() => void enter(role)}>
          {busy === role ? 'Входим…' : `Войти как ${DEMO_ROLE_LABELS[role].toLowerCase()}`}
        </button>
      ))}
    </div>
  )
  if (!framed) return buttons
  return (
    <div className="card" style={{ margin: '0 0 18px', padding: 14, textAlign: 'left' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--gold)', marginBottom: 4 }}>Демо-доступ для жюри</div>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.5, color: 'var(--dim)', margin: '0 0 10px' }}>
        Войдите в демо-академию без аккаунта. Внутри — панель «Демо» для новых событий в реальном времени.
      </p>
      {buttons}
    </div>
  )
}
