import { useEffect } from 'react'
import { RegisterFlowScreen } from '../features/auth/RegisterFlowScreen'
import { RegisterRoleScreen } from '../features/auth/RegisterRoleScreen'
import { WebLoginScreen } from '../features/auth/WebLoginScreen'
import { GuestHomeworkScreen } from '../features/guest/GuestHomeworkScreen'
import { GuestPortfolioScreen } from '../features/guest/GuestPortfolioScreen'
import { GuestStudentScreen } from '../features/guest/GuestStudentScreen'
import { HomeworkNewScreen } from '../features/homework/HomeworkNewScreen'
import { HomeworkViewScreen } from '../features/homework/HomeworkViewScreen'
import { AdminScreen } from '../features/admin/AdminScreen'
import { AdminStudentScreen } from '../features/admin/AdminStudentScreen'
import { AdminTeacherScreen } from '../features/admin/AdminTeacherScreen'
import { StaffChatScreen } from '../features/chat/StaffChatScreen'
import { TeacherScreen } from '../features/teacher/TeacherScreen'
import { TeacherStudentScreen } from '../features/teacher/TeacherStudentScreen'
import { FeedbackScreen } from '../features/student/FeedbackScreen'
import { StudentScreen } from '../features/student/StudentScreen'
import { getMax } from '../platform/max'
import { ErrorScreen } from '../screens/ErrorScreen'
import { LoadingScreen } from '../screens/LoadingScreen'
import { useLightboxKeys } from '../ui/Lightbox'
import { DemoPanel } from '../features/demo/DemoPanel'
import { DemoRolesScreen } from '../features/demo/DemoRolesScreen'
import { Toasts } from '../ui/Toasts'
import { bootstrap } from './bootstrap'
import type { ScreenName } from './screens'
import { useApp } from './store'

function Screen({ name }: { name: ScreenName }) {
  switch (name) {
    case 'loading':
      return <LoadingScreen />
    case 'error':
      return <ErrorScreen />
    case 'web-login':
      return <WebLoginScreen />
    case 'register-role':
      return <RegisterRoleScreen />
    case 'register-flow':
    case 'demo-roles':
      return <DemoRolesScreen />
      return <RegisterFlowScreen />
    case 'student':
      return <StudentScreen />
    case 'feedback':
      return <FeedbackScreen />
    case 'hw-view':
      return <HomeworkViewScreen />
    case 'hw-new':
      return <HomeworkNewScreen />
    case 'teacher':
      return <TeacherScreen />
    case 't-student':
      return <TeacherStudentScreen />
    case 'admin':
      return <AdminScreen />
    case 'admin-student':
      return <AdminStudentScreen />
    case 'admin-teacher':
      return <AdminTeacherScreen />
    case 'teacher-chat':
    case 'admin-chat':
      return <StaffChatScreen />
    case 'guest':
      return <GuestPortfolioScreen />
    case 'guest-student':
      return <GuestStudentScreen />
    case 'guest-hw-view':
      return <GuestHomeworkScreen />
    default:
      return null
  }
}

/** Системная кнопка «Назад» MAX повторяет стек экранов. */
function useMaxBackButton() {
  const depth = useApp((s) => s.stack.length)
  const back = useApp((s) => s.back)
  useEffect(() => {
    const max = getMax()
    if (!max?.initData || !max.BackButton) return
    const button = max.BackButton
    try {
      if (depth > 0) {
        button.show()
        button.onClick(back)
        return () => button.offClick(back)
      }
      button.hide()
    } catch {
      // старый SDK без BackButton
    }
  }, [depth, back])
}

/** StrictMode в разработке вызывает эффекты дважды; bootstrap должен стартовать один раз. */
let bootstrapped = false

export function App() {
  const scr = useApp((s) => s.scr)
  useMaxBackButton()
  useLightboxKeys()
  useEffect(() => {
    if (bootstrapped) return
    bootstrapped = true
    void bootstrap()
  }, [])
  return (
    <>
      <Screen name={scr} />
      <Toasts />
    </>
  )
}
      <DemoPanel />
