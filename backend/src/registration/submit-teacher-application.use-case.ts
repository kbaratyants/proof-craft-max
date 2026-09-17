import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import { UserNotificationGateway } from '../notifications/user-notification.gateway.js'
import { RegistrationRepository } from './registration.repository.js'
import type { SubmitTeacherApplicationCommand } from './teacher-application.body.js'

const normalizePhone = (value: string): string | null => {
  const phone = value.replace(/\s+/g, '')
  return /^(\+?\d{10,15})$/.test(phone) ? phone : null
}

@Injectable()
export class SubmitTeacherApplicationUseCase {
  constructor(
    @Inject(RegistrationRepository)
    private readonly registrations: RegistrationRepository,
    @Inject(UserNotificationGateway)
    private readonly notifications: UserNotificationGateway,
  ) {}

  async execute(
    principal: AuthenticatedPrincipal,
    command: SubmitTeacherApplicationCommand,
  ): Promise<{ ok: true }> {
    const phone = normalizePhone(command.phone)
    if (!phone) {
      throw new HttpException(
        { ok: false, error: 'Укажите корректный номер телефона.' },
        HttpStatus.BAD_REQUEST,
      )
    }
    const fullName = command.fullName.trim()
    if (!fullName) {
      throw new HttpException(
        { ok: false, error: 'Укажите ФИО.' },
        HttpStatus.BAD_REQUEST,
      )
    }
    const [firstName = '', ...lastNameParts] = fullName.split(/\s+/).filter(Boolean)
    const lastName = lastNameParts.length ? lastNameParts.join(' ') : null
    const adminMessage = `Заявка на роль преподавателя (мини-апп):\n${fullName}\nТелефон: ${phone}\nID в приложении: ${principal.claimedMaxUserId}`
    const result = await this.registrations.saveTeacherApplication({
      existingUserId: principal.user?.id ?? null,
      claimedMaxUserId: principal.claimedMaxUserId,
      firstName,
      lastName,
      fullName,
      phone,
      adminMessage,
      createdAt: sqliteTimestamp(),
    })
    for (const maxUserId of result.adminMaxUserIds) {
      void this.notifications.send(maxUserId, adminMessage).catch(() => {})
    }
    return { ok: true }
  }
}
