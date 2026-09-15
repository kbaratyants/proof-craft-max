export type UserIdentity = {
  id: number
  maxUserId: number
  roles: string[]
}

export abstract class UserIdentityRepository {
  abstract findByMaxUserId(maxUserId: number): Promise<UserIdentity | null>
  abstract findByWebSessionTokenHash(tokenHash: string, now: string): Promise<UserIdentity | null>
  abstract touchWebSession(tokenHash: string, now: string): Promise<void>
}
