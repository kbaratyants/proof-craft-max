import { Inject, Injectable } from '@nestjs/common'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import { DEMO_ACCOUNTS, demoEnabled } from '../demo/demo.constants.js'
import { DemoViewersService } from '../demo/demo-viewers.service.js'
import { PrismaService } from '../persistence/prisma/prisma.service.js'
import { UserIdentityRepository } from '../persistence/users/user-identity.repository.js'
import type { ChannelUser } from './channel.types.js'

/**
 * Пользователь мессенджера → внутренний пользователь: находит по
 * max_user_id, иначе создаёт guest. Существующему пользователю гарантирует строку роли из `users.role`.
 */
@Injectable()
export class MessengerIdentityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UserIdentityRepository) private readonly users: UserIdentityRepository,
    @Inject(DemoViewersService) private readonly demoViewers: DemoViewersService,
  ) {}

  /**
   * Жюри, вошедшее в демо из MAX, работает с ботом от демо-роли: команды показывают демо-академию,
   * а `demoViewerMaxUserId` — куда пересылать вызванные им уведомления.
   */
  async resolve(user: ChannelUser): Promise<AuthenticatedPrincipal> {
    const real = await this.resolveReal(user)
    if (!demoEnabled()) return real
    const role = await this.demoViewers.roleOf(user.externalId)
    const demoUser = role ? await this.users.findByMaxUserId(DEMO_ACCOUNTS[role]) : null
    if (!role || !demoUser) return real
    return { provider: 'max', claimedMaxUserId: DEMO_ACCOUNTS[role], user: demoUser, demoViewerMaxUserId: user.externalId }
  }

  private async resolveReal(user: ChannelUser): Promise<AuthenticatedPrincipal> {
    const maxUserId = BigInt(user.externalId)
    const now = sqliteTimestamp()
    const existing = await this.prisma.users.findUnique({ where: { max_user_id: maxUserId }, select: { id: true, role: true } })
    if (!existing) {
      await this.prisma.users.create({
        data: {
          max_user_id: maxUserId,
          username: user.username,
          first_name: user.firstName,
          last_name: user.lastName,
          role: 'guest',
          created_at: now,
          updated_at: now,
          user_roles: { create: { role: 'guest', created_at: now } },
        },
      })
    } else if (existing.role) {
      await this.prisma.user_roles.upsert({
        where: { user_id_role: { user_id: existing.id, role: existing.role } },
        create: { user_id: existing.id, role: existing.role, created_at: now },
        update: {},
      })
    }
    const identity = await this.users.findByMaxUserId(user.externalId)
    return { provider: 'max', claimedMaxUserId: user.externalId, user: identity }
  }
}

export const hasRole = (principal: AuthenticatedPrincipal, role: string): boolean => principal.user?.roles.includes(role) ?? false
