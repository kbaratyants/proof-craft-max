import { Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../persistence/prisma/prisma.service.js'
import { WebAuthRepository, type WebLoginProvider, type WebLoginState } from './web-auth.repository.js'

@Injectable()
export class PrismaWebAuthRepository extends WebAuthRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super()
  }

  async createLoginRequest(provider: WebLoginProvider, tokenHash: string, expiresAt: string, now: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.web_login_requests.deleteMany({ where: { expires_at: { lt: now } } }),
      this.prisma.web_login_requests.create({
        data: { provider, token_hash: tokenHash, expires_at: expiresAt, created_at: now },
      }),
    ])
  }

  async getLoginState(tokenHash: string, now: string): Promise<WebLoginState> {
    const row = await this.prisma.web_login_requests.findFirst({
      where: { token_hash: tokenHash, expires_at: { gt: now } },
      select: { user_id: true },
    })
    if (!row) return 'expired'
    return row.user_id ? 'approved' : 'pending'
  }

  async approveLoginRequest(tokenHash: string, provider: WebLoginProvider, userId: number, now: string): Promise<boolean> {
    const result = await this.prisma.web_login_requests.updateMany({
      where: { token_hash: tokenHash, provider, user_id: null, expires_at: { gt: now } },
      data: { user_id: userId, approved_at: now },
    })
    return result.count === 1
  }

  async consumeLoginRequest(
    tokenHash: string,
    sessionTokenHash: string,
    sessionExpiresAt: string,
    now: string,
  ): Promise<{ userId: number; maxUserId: number } | null> {
    return await this.prisma.$transaction(async (transaction) => {
      const request = await transaction.web_login_requests.findFirst({
        where: { token_hash: tokenHash, user_id: { not: null }, expires_at: { gt: now } },
        select: { id: true, user_id: true, users: { select: { max_user_id: true } } },
      })
      if (!request?.user_id || !request.users) return null
      // deleteMany вместо delete: параллельная вкладка могла уже забрать запрос.
      const deleted = await transaction.web_login_requests.deleteMany({ where: { id: request.id } })
      if (deleted.count !== 1) return null
      await transaction.web_sessions.deleteMany({ where: { expires_at: { lt: now } } })
      await transaction.web_sessions.create({
        data: {
          user_id: request.user_id,
          token_hash: sessionTokenHash,
          expires_at: sessionExpiresAt,
          last_seen_at: now,
          created_at: now,
        },
      })
      return { userId: request.user_id, maxUserId: Number(request.users.max_user_id) }
    })
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.prisma.web_sessions.deleteMany({ where: { token_hash: tokenHash } })
  }

  async appendAudit(userId: number, action: string, meta: object, now: string): Promise<void> {
    await this.prisma.audit_log.create({
      data: { actor_user_id: userId, action, meta: JSON.stringify(meta), created_at: now },
    })
  }
}
