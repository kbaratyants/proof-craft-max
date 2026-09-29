/** Ссылки «Поделиться» на гостевую витрину: `?guest=1&student=…&hw=…` на сайте и `startapp=guest_<id>[_hw_<id>]` в MAX. */

export type GuestLinkTarget = { studentId: number; homeworkId: number | null }

export const positiveId = (value: string | null | undefined): number | null => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Параметр запуска мини-приложения для витрины ученика и, при необходимости, его работы. */
export const guestStartParam = (studentId: number, homeworkId?: number | null): string =>
  `guest_${studentId}${homeworkId ? `_hw_${homeworkId}` : ''}`

/** `guest_181` и `guest_181_hw_42` → ученик и работа; всё остальное (в том числе `demo`) — null. */
export function parseGuestStartParam(value: string | null | undefined): GuestLinkTarget | null {
  const match = /^guest_(\d+)(?:_hw_(\d+))?$/.exec(value ?? '')
  const studentId = positiveId(match?.[1])
  if (!match || !studentId) return null
  const homeworkId = match[2] === undefined ? null : positiveId(match[2])
  if (match[2] !== undefined && !homeworkId) return null
  return { studentId, homeworkId }
}
