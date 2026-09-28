import { useEffect } from 'react'
import { holdClosingConfirmation } from '../platform/bridge'

/** Пока `dirty` — MAX спросит подтверждение при закрытии мини-приложения. */
export function useClosingGuard(dirty: boolean) {
  useEffect(() => (dirty ? holdClosingConfirmation() : undefined), [dirty])
}
