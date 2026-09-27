import type { UserIdentity } from '../persistence/users/user-identity.repository.js'

export type AuthProvider = 'max' | 'web-session'

export type AuthenticatedPrincipal = {
  provider: AuthProvider
  claimedMaxUserId: number
  user: UserIdentity | null
}

export type AuthenticationRequest = {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  query?: unknown
  body?: unknown
  authenticatedPrincipal?: AuthenticatedPrincipal
}
