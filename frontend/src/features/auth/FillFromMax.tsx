import { useState } from 'react'
import { isMaxMiniApp, maxProfileName, requestMaxPhone } from '../../platform/max'
import { toast } from '../../ui/toast'

type Filled = { firstName?: string; lastName?: string; phone?: string }

/**
 * «Заполнить из MAX»: имя и фамилия берутся из профиля MAX сразу,
 * телефон — после разрешения пользователя в окне MAX. Показывается только внутри мини-приложения.
 */
export function FillFromMax({ onFill }: { onFill: (values: Filled) => void }) {
  const [busy, setBusy] = useState(false)
  if (!isMaxMiniApp()) return null
  const fill = async () => {
    setBusy(true)
    const name = maxProfileName()
    if (name) onFill({ ...(name.firstName ? { firstName: name.firstName } : {}), ...(name.lastName ? { lastName: name.lastName } : {}) })
    const phone = await requestMaxPhone()
    if (phone) onFill({ phone })
    else toast('Телефон из MAX не получен — введите его вручную')
    setBusy(false)
  }
  return (
    <button type="button" className="btn bs btn-w" style={{ marginBottom: 12 }} disabled={busy} onClick={() => void fill()}>
      {busy ? 'Запрашиваем данные…' : 'Заполнить из MAX'}
    </button>
  )
}
