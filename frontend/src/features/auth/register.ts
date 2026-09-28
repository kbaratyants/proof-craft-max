import { apiPost } from '../../api/client'
import { bootstrap } from '../../app/bootstrap'
import { useApp } from '../../app/store'
import { STORAGE_KEYS, session } from '../../platform/storage'
import { toast } from '../../ui/toast'

export type RegisterRole = 'student' | 'teacher' | 'admin' | 'guest'

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message) || fallback

/** Выбор роли на стартовом экране. */
export function pickRegisterRole(role: RegisterRole) {
  const app = useApp.getState()
  if (role === 'guest') {
    try {
      sessionStorage.setItem(STORAGE_KEYS.guest, '1')
    } catch {
      // без sessionStorage гостевой режим не переживёт перезагрузку — не критично
    }
    app.patch({ isGuestMode: true, registerRole: null, registerTab: 'reg', teacherApplicationSent: false })
    app.go('guest')
    return
  }
  app.patch({ registerRole: role, registerTab: 'reg', teacherApplicationSent: false })
  app.go('register-flow')
}

export type StudentForm = { firstName: string; lastName: string; phone: string; metro: string; lessons: string }

export async function submitStudentRegistration(form: StudentForm) {
  const fn = form.firstName.trim()
  const ln = form.lastName.trim()
  const phone = form.phone.trim()
  const metro = form.metro.trim()
  const lessons = form.lessons.trim()
  if (!fn || !ln || !phone || !lessons) {
    toast('Заполните обязательные поля', 'warning')
    return
  }
  const { platform, appUserId } = useApp.getState()
  try {
    await apiPost(platform, '/api/students', {
      max_user_id: appUserId,
      full_name: [fn, ln].filter(Boolean).join(' ').trim(),
      phone,
      lessons_count: lessons,
      first_name: fn,
      last_name: ln,
      metro: metro || undefined,
    })
    toast('Заявка отправлена', 'success')
    useApp.getState().go('loading')
    await bootstrap()
  } catch (error) {
    toast(errorMessage(error, 'Не удалось отправить'), 'error')
  }
}

export type TeacherForm = { firstName: string; lastName: string; phone: string }

export async function submitTeacherApplication(form: TeacherForm) {
  const fn = form.firstName.trim()
  const ln = form.lastName.trim()
  const phone = form.phone.trim()
  if (!fn || !ln || !phone) {
    toast('Заполните все поля', 'warning')
    return
  }
  const { platform, appUserId } = useApp.getState()
  try {
    await apiPost(platform, '/api/teacher-application', {
      max_user_id: appUserId,
      full_name: [fn, ln].filter(Boolean).join(' ').trim(),
      phone,
    })
    useApp.getState().patch({ teacherApplicationSent: true })
    toast('Заявка отправлена', 'success')
  } catch (error) {
    toast(errorMessage(error, 'Не удалось отправить'), 'error')
  }
}

export const clearGuestMode = () => session.remove(STORAGE_KEYS.guest)
