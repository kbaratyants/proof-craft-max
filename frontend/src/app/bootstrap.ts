import { apiGet, apiPost } from '../api/client'
import type { Session, WebAuthSession } from '../api/types'
import { detectPlatform } from '../platform/detect'
import { getStartParam, isMaxMiniApp } from '../platform/max'
import { STORAGE_KEYS, local, session as sessionStore } from '../platform/storage'
import { parseGuestStartParam, positiveId } from './guestLink'
import { useApp } from './store'

/**
 * Параметр запуска витрины (`startapp=guest_…`) действует один раз: после выхода из витрины
 * или выхода из аккаунта повторный bootstrap идёт обычным путём, хотя MAX всё ещё отдаёт тот же start_param.
 */
let guestStartParamUsed = false
let openedFromGuestStartParam = false

/** Витрину открыли ссылкой «Поделиться» из MAX: выход из неё — обычный запуск приложения. */
export const isGuestFromStartParam = () => openedFromGuestStartParam

/**
 * Определение платформы, сессии и стартового экрана.
 * Для локальной разработки используется web-session или `?guest=1`.
 */
export async function bootstrap({ skipDemoEntry = false }: { skipDemoEntry?: boolean } = {}) {
  const app = useApp.getState()
  app.patch({ error: '' })
  const pageParams = new URLSearchParams(window.location.search)

  const platform = await detectPlatform()
  app.patch({ platform, appUserId: platform.appUserId })

  // Вход жюри: ссылка ?demo=1 или кнопка бота «Демо для жюри» (start_param=demo), пока не выбрана демо-роль.
  const wantsDemo = pageParams.get('demo') === '1' || getStartParam() === 'demo'
  if (wantsDemo && !skipDemoEntry && local.get(STORAGE_KEYS.demo) !== '1') {
    app.replace('demo-roles', { stack: [] })
    return
  }

  // Публичная витрина не требует MAX или учётной записи: `?guest=1` на сайте или `startapp=guest_…` в MAX.
  const fromStartParam = guestStartParamUsed ? null : parseGuestStartParam(getStartParam())
  guestStartParamUsed = true
  openedFromGuestStartParam = fromStartParam != null
  if (pageParams.get('guest') === '1' || fromStartParam) {
    app.replace('guest', { isGuestMode: true, stack: [] })
    // Ссылка «Поделиться»: сразу портфолио ученика и, если указана, его работа.
    const target = fromStartParam ?? { studentId: positiveId(pageParams.get('student')), homeworkId: positiveId(pageParams.get('hw')) }
    if (target.studentId) {
      app.patch({ guestStudentId: target.studentId, guestOpenHomeworkId: target.homeworkId })
      useApp.getState().go('guest-student')
    }
    return
  }

  let appUserId = platform.appUserId
  if (!appUserId && platform.webSessionToken) {
    try {
      const web = await apiGet<WebAuthSession>(platform, '/api/web-auth/session')
      appUserId = web.max_user_id
      platform.appUserId = appUserId
    } catch {
      local.remove(STORAGE_KEYS.webSession)
      platform.webSessionToken = null
    }
    app.patch({ platform: { ...platform }, appUserId })
  }

  if (!appUserId) {
    app.replace('web-login', { stack: [] })
    return
  }

  try {
    const session = await apiGet<Session>(platform, `/api/session?max_user_id=${encodeURIComponent(appUserId)}`)
    app.patch({ session })

    if (session?.hasUser) {
      sessionStore.remove(STORAGE_KEYS.guest)
      app.patch({ isGuestMode: false })
    }
    const resumeGuest = sessionStore.get(STORAGE_KEYS.guest) === '1'

    if (!session?.hasUser && resumeGuest) {
      app.replace('guest', {
        isGuestMode: true,
        tab: null,
        registerRole: null,
        registerTab: 'reg',
        teacherApplicationSent: false,
        stack: [],
      })
      return
    }

    // Корневые экраны открываются с пустой историей: «Назад» не должен вести на загрузку или вход.
    if (!session?.hasUser) {
      app.replace('register-role', { stack: [], tab: null, registerRole: null, registerTab: 'reg', teacherApplicationSent: false, isGuestMode: false })
      return
    }

    if (pageParams.get('feedback') === '1' && session.student) {
      app.replace('student', { stack: [], tab: 'home' })
      useApp.getState().go('feedback')
    } else if (session.isAdmin) {
      app.replace('admin', { stack: [], tab: 'pending' })
    } else if (session.isTeacher) {
      app.replace('teacher', { stack: [], tab: 'profile' })
    } else {
      app.replace('student', { stack: [], tab: 'home' })
    }
  } catch (error) {
    app.patch({ error: error instanceof Error && error.message ? error.message : 'Не удалось загрузить данные' })
    app.replace('error', { stack: [] })
  }
}

/** Выход: сброс web-сессии, гостевого режима и навигации. */
export function logout() {
  const { platform } = useApp.getState()
  if (platform?.webSessionToken) {
    void apiPost(platform, '/api/web-auth/logout', {}).catch(() => {})
    local.remove(STORAGE_KEYS.webSession)
  }
  if (local.get(STORAGE_KEYS.demo) === '1' && isMaxMiniApp()) void apiPost(platform, '/api/demo/leave', {}).catch(() => {})
  local.remove(STORAGE_KEYS.demo)
  sessionStore.remove(STORAGE_KEYS.guest)
  useApp.getState().patch({
    session: null,
    error: '',
    stack: [],
    tab: null,
    selectedStudent: null,
    selectedHomework: null,
    selectedAdminTeacher: null,
    registerRole: null,
    registerTab: 'reg',
    teacherApplicationSent: false,
    isGuestMode: false,
  })
  useApp.getState().go('loading')
  void bootstrap()
}

/** Повторная попытка после ошибки. */
export function retry() {
  useApp.getState().go('loading')
  void bootstrap()
}
