import { useEffect, useRef, type ReactNode } from 'react'
import { haptic } from '../platform/bridge'

export type TabItem = { key: string; label: string; icon: ReactNode; count?: number }

/** Нижняя панель вкладок. */
export function TabBar({ tabs, active, onSelect }: { tabs: TabItem[]; active: string; onSelect: (key: string) => void }) {
  // Новая заявка, сообщение или уведомление, пришедшие в реальном времени, — короткая вибрация.
  // Счётчик undefined, пока данные грузятся: первая загрузка сигналом не считается.
  const counts = tabs.map((t) => t.count ?? null).join(',')
  const previous = useRef<Record<string, number | undefined>>({})
  useEffect(() => {
    const grew = tabs.some((t) => t.count != null && previous.current[t.key] != null && t.count > previous.current[t.key]!)
    if (grew) haptic.notify('warning')
    previous.current = Object.fromEntries(tabs.map((t) => [t.key, t.count]))
    // tabs пересоздаётся на каждом рендере — эффект зависит только от счётчиков.
  }, [counts])
  return (
    <div className="tab">
      {tabs.map((t) => (
        <button key={t.key} className={`tb${t.key === active ? ' on' : ''}`} onClick={() => {
            if (t.key !== active) haptic.select()
            onSelect(t.key)
          }}>
          <span style={{ position: 'relative' }}>
            {t.icon}
            {(t.count ?? 0) > 0 && <span className="dot">{t.count}</span>}
          </span>
          {t.label}
        </button>
      ))}
    </div>
  )
}
