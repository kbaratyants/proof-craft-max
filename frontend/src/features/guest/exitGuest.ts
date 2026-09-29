import { bootstrap, isGuestFromStartParam } from '../../app/bootstrap'
import { useApp } from '../../app/store'
import { STORAGE_KEYS, session } from '../../platform/storage'

/** Выход из гостевой витрины. */
export function exitGuest() {
  if (new URLSearchParams(window.location.search).get('guest') === '1') {
    window.location.assign(window.location.pathname)
    return
  }
  session.remove(STORAGE_KEYS.guest)
  // Витрина из ссылки в MAX: пользователь может быть уже зарегистрирован — обычный запуск откроет его кабинет.
  if (isGuestFromStartParam()) {
    useApp.getState().replace('loading', { isGuestMode: false, guestStudentId: null, selectedHomework: null, stack: [] })
    void bootstrap()
    return
  }
  useApp.getState().replace('register-role', {
    isGuestMode: false,
    guestStudentId: null,
    selectedHomework: null,
    stack: [],
  })
}
