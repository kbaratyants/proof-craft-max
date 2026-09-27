import { existsSync, readFileSync } from 'node:fs'

/**
 * Снимок демо-академии: анонимизированные ученики, преподаватели и работы.
 * Фото уже лежат в хранилище — в снимке только ключи объектов (`fileKey`).
 */
export type DemoSnapshot = {
  teachers: Array<{ key: string; firstName: string; lastName: string; about: string | null; demoAccount?: boolean }>
  students: Array<{
    key: string
    firstName: string
    lastName: string
    phone: string
    lessons: number
    status: string
    track: string
    metro: string | null
    about: string | null
    createdAt: string
    teacherKeys: string[]
    demoAccount?: boolean
  }>
  homeworks: Array<{
    studentKey: string
    lesson: number | null
    isBonus: boolean
    contentType: string
    fileKey: string | null
    text: string | null
    status: string
    haircut: string | null
    revisionText: string | null
    createdAt: string
    updatedAt: string
    files: Array<{ fileKey: string; contentType: string; sortOrder: number }>
    reviews: Array<{ teacherKey: string; rating: number | null; comment: string | null; status: string; createdAt: string }>
    comments: Array<{ authorKey: string; text: string; createdAt: string }>
  }>
}

export const loadDemoSnapshot = (): DemoSnapshot | null => {
  const path = process.env.DEMO_SNAPSHOT_PATH?.trim()
  if (!path || !existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as DemoSnapshot
}
