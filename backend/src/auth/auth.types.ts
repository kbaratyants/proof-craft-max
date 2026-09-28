import type { UserIdentity } from '../persistence/users/user-identity.repository.js'

export type AuthProvider = 'max' | 'web-session'

export type AuthenticatedPrincipal = {
  provider: AuthProvider
  claimedMaxUserId: number
  user: UserIdentity | null
  /** Демо-сессия, открытая из MAX: реальный пользователь MAX, который смотрит демо. */
  demoViewerMaxUserId?: number
}

export type AuthenticationRequest = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  query?: unknown
  body?: unknown
  authenticatedPrincipal?: AuthenticatedPrincipal
}
