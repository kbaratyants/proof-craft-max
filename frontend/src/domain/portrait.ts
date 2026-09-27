const MALE_NAMES_ON_A = new Set(['илья', 'никита', 'кузьма', 'фома', 'лука', 'савва', 'данила', 'гаврила'])
const FEMALE_SURNAME = /(ова|ева|ёва|ина|ына|ская|цкая|ая)$/
const MALE_SURNAME = /(ов|ев|ёв|ин|ын|ский|цкий|ой|ий)$/

/** Пол по ФИО: сначала по фамилии, затем по имени (имена на -а/-я, кроме исключений, — женские). */
export function looksFemale(fullName: string): boolean {
  const parts = String(fullName || '').toLowerCase().split(/\s+/).filter(Boolean)
  for (const part of parts) {
    if (part.length > 4 && FEMALE_SURNAME.test(part)) return true
    if (part.length > 4 && MALE_SURNAME.test(part)) return false
  }
  return parts.some((part) => /[ая]$/.test(part) && !MALE_NAMES_ON_A.has(part))
}

/** Условный портрет для ученика без фото: по полу и стабильно по ID (три варианта на каждый пол). */
export function placeholderPortrait(id: number, fullName: string): string {
  const variant = (Math.abs(Math.trunc(Number(id) || 0)) % 3) + 1
  return `/placeholders/${looksFemale(fullName) ? 'female' : 'male'}-${variant}.jpg`
}

const WORK_PLACEHOLDERS = ['/demo-homework-fade.png', '/demo-homework-crop.png', '/demo-homework-beard.png']

/** Картинка-заглушка работы: показывается, пока грузится настоящее фото (и для работ без фото). */
export const workPlaceholder = (seed: number): string =>
  WORK_PLACEHOLDERS[Math.abs(Math.trunc(Number(seed) || 0)) % WORK_PLACEHOLDERS.length]!
