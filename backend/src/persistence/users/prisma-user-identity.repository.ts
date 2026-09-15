import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { UserIdentityRepository, type UserIdentity } from './user-identity.repository.js'

@Injectable()
export class PrismaUserIdentityRepository implements UserIdentityRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByMaxUserId(maxUserId: number): Promise<UserIdentity | null> {
    const user = await this.prisma.users.findUnique({
      where: { max_user_id: BigInt(maxUserId) },
      select: {
        id: true,
        max_user_id: true,
        user_roles: {
          select: { role: true },
          orderBy: { role: 'asc' },
        },
      },
    })
    return user ? this.toIdentity(user) : null
  }

  async findByWebSessionTokenHash(tokenHash: string, now: string): Promise<UserIdentity | null> {
    const session = await this.prisma.web_sessions.findFirst({
      where: {
        token_hash: tokenHash,
        expires_at: { gt: now },
      },
      select: {
        users: { select: this.identitySelect },
      },
    })
    return session ? this.toIdentity(session.users) : null
  }

  async touchWebSession(tokenHash: string, now: string): Promise<void> {
    await this.prisma.web_sessions.updateMany({
      where: {
        token_hash: tokenHash,
        expires_at: { gt: now },
      },
      data: { last_seen_at: now },
    })
  }

  private readonly identitySelect = {
    id: true,
    max_user_id: true,
    user_roles: {
      select: { role: true },
      orderBy: { role: 'asc' as const },
    },
  }

  private toIdentity(user: {
    id: number
    max_user_id: bigint
    user_roles: { role: string }[]
  }): UserIdentity {
    return {
      id: user.id,
      maxUserId: Number(user.max_user_id),
      roles: user.user_roles.map(({ role }) => role),
    }
  }
}
