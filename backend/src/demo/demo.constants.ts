import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Демо-пользователи получают идентификаторы далеко за пределами диапазона MAX:
 * бот никогда не пишет им и не может случайно написать реальному человеку.
 */
export const DEMO_ID_BASE = 900_000_000_000_000

export const DEMO_ACCOUNTS = {
  admin: DEMO_ID_BASE + 1,
  teacher: DEMO_ID_BASE + 2,
  student: DEMO_ID_BASE + 3,
} as const

export type DemoRole = keyof typeof DEMO_ACCOUNTS

export const isDemoMaxUserId = (maxUserId: number): boolean => maxUserId >= DEMO_ID_BASE

export const demoEnabled = (): boolean =>
  ['1', 'true', 'yes', 'on'].includes(String(process.env.DEMO_MODE || '').trim().toLowerCase())

const simulation = new AsyncLocalStorage<true>()

/** Действия, запущенные эмулятором, не отправляют сообщений в MAX — даже реальным администраторам. */
export const runAsDemoSimulation = <T>(fn: () => Promise<T>): Promise<T> => simulation.run(true, fn)

export const insideDemoSimulation = (): boolean => simulation.getStore() === true

export const DEMO_ROLE_LABELS: Record<DemoRole, string> = { admin: 'администратор', teacher: 'преподаватель', student: 'ученик' }

export const demoRoleOf = (maxUserId: number): DemoRole | null =>
  (Object.keys(DEMO_ACCOUNTS) as DemoRole[]).find((role) => DEMO_ACCOUNTS[role] === maxUserId) ?? null

const viewer = new AsyncLocalStorage<number>()

/**
 * Реальный пользователь MAX, который смотрит демо (жюри). Уведомления демо-пользователям,
 * вызванные его действиями, бот пересылает ему в чат; реальным пользователям из этого контекста ничего не уходит.
 */
export const withDemoViewer = <T>(viewerMaxUserId: number, fn: () => T): T => viewer.run(viewerMaxUserId, fn)

export const currentDemoViewer = (): number | null => viewer.getStore() ?? null
