import { apiGet, apiPost } from '../../api/client'
import { bootstrap } from '../../app/bootstrap'
import { useApp } from '../../app/store'
import { STORAGE_KEYS, local } from '../../platform/storage'

export type DemoRole = 'admin' | 'teacher' | 'student'
export type DemoAction = 'homework' | 'student_application' | 'teacher_application' | 'chat_message' | 'profile_edit'
export type DemoConfig = { enabled: boolean; roles: DemoRole[]; actions: DemoAction[] }

const standalone = { platform: 'standalone' as const }

export const DEMO_ROLE_LABELS: Record<DemoRole, string> = {
  admin: 'Администратор',
  teacher: 'Преподаватель',
  student: 'Ученик',
}

export const DEMO_ACTION_LABELS: Record<DemoAction, string> = {
  homework: 'Ученик сдаёт работу',
  student_application: 'Новая заявка ученика',
  teacher_application: 'Заявка преподавателя',
  chat_message: 'Сообщение в чат',
  profile_edit: 'Запрос правки профиля',
}

export const fetchDemoConfig = () => apiGet<DemoConfig>(standalone, '/api/demo/config')

/** Вход жюри за демо-пользователя: обычная web-сессия плюс отметка демо-режима. */
export async function demoLogin(role: DemoRole) {
  const data = await apiPost<{ session_token: string; max_user_id: number }>(standalone, '/api/demo/login', { role })
  local.set(STORAGE_KEYS.webSession, data.session_token)
  local.set(STORAGE_KEYS.demo, '1')
  useApp.getState().go('loading')
  await bootstrap()
}

export async function simulate(action: DemoAction) {
  const { platform, appUserId } = useApp.getState()
  return await apiPost<{ message: string }>(platform, '/api/demo/simulate', { max_user_id: appUserId, action })
}
