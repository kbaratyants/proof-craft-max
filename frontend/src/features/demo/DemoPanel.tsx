import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { refreshSessionQuiet } from '../../app/session'
import { useApp } from '../../app/store'
import { STORAGE_KEYS, local } from '../../platform/storage'
import { toast } from '../../ui/toast'
import { DEMO_ACTION_LABELS, type DemoAction, simulate } from './api'

const ACTIONS = Object.keys(DEMO_ACTION_LABELS) as DemoAction[]

/**
 * Панель эмулятора для жюри: события создаются на сервере через обычные сценарии,
 * после чего данные экранов перезапрашиваются.
 */
export function DemoPanel() {
  const hasSession = useApp((s) => Boolean(s.session?.hasUser))
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<DemoAction | null>(null)
  if (local.get(STORAGE_KEYS.demo) !== '1' || !hasSession) return null

  const run = async (action: DemoAction) => {
    setBusy(action)
    try {
      const { message } = await simulate(action)
      toast(message, 'success')
      await queryClient.invalidateQueries()
      await refreshSessionQuiet()
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : 'Не удалось выполнить действие', 'error')
    } finally {
      setBusy(null)
    }
  }

  const switchRole = () => {
    setOpen(false)
    local.remove(STORAGE_KEYS.demo)
    local.remove(STORAGE_KEYS.webSession)
    useApp.getState().patch({ session: null, stack: [], tab: null })
    useApp.getState().replace('demo-roles', { stack: [] })
  }

  return (
    <div className="demo-panel" data-open={open ? '1' : undefined}>
      {open && (
        <div className="demo-panel__sheet card" role="dialog" aria-label="Демо-режим">
          <div className="demo-panel__title">Демо-режим</div>
          <p className="demo-panel__hint">События появятся у администратора и преподавателя — переключайте роли и проверяйте.</p>
          {ACTIONS.map((action) => (
            <button key={action} type="button" className="btn bs btn-w" disabled={busy != null} onClick={() => void run(action)}>
              {busy === action ? 'Создаём…' : DEMO_ACTION_LABELS[action]}
            </button>
          ))}
          <button type="button" className="btn bf btn-w" onClick={switchRole}>
            Сменить роль
          </button>
        </div>
      )}
      <button type="button" className="demo-panel__fab" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? '×' : 'Демо'}
      </button>
    </div>
  )
}
