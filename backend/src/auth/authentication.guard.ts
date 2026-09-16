import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common'
import { authHttpError } from './auth.errors.js'
import type { AuthenticationRequest } from './auth.types.js'
import { AuthenticationService } from './authentication.service.js'

const claimedMaxUserIdFrom = (source: unknown): unknown =>
  (source as { max_user_id?: unknown } | null)?.max_user_id

const parseClaimedMaxUserId = (request: AuthenticationRequest): number => {
  const value = claimedMaxUserIdFrom(request.query) ?? claimedMaxUserIdFrom(request.body)
  const maxUserId =
    (typeof value === 'string' && value.trim() !== '') || typeof value === 'number'
      ? Number(value)
      : Number.NaN
  if (!Number.isSafeInteger(maxUserId) || maxUserId <= 0) {
    throw authHttpError(HttpStatus.BAD_REQUEST, 'Некорректные параметры запроса.')
  }
  return maxUserId
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(AuthenticationService) private readonly authentication: AuthenticationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticationRequest>()
    const claimedMaxUserId = parseClaimedMaxUserId(request)
    request.authenticatedPrincipal = await this.authentication.authenticate(request, claimedMaxUserId)
    return true
  }
}
