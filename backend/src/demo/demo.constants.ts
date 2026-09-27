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
