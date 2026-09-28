import { create } from 'zustand'
import { haptic, type HapticKind } from '../platform/bridge'

type Toast = { id: number; message: string }

export const useToasts = create<{ items: Toast[] }>()(() => ({ items: [] }))

let nextId = 1

/** Всплывающее сообщение на 2.2 с; `kind` добавляет вибрацию: успех, ошибка или предупреждение. */
export function toast(message: string, kind?: HapticKind) {
  if (kind) haptic.notify(kind)
  const id = nextId++
  useToasts.setState((s) => ({ items: [...s.items, { id, message }] }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), 2200)
}
