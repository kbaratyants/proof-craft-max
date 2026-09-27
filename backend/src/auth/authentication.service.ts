import crypto from 'node:crypto'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { maxBotToken } from '../common/max-config.js'
import { UserIdentityRepository } from '../persistence/users/user-identity.repository.js'
import { authHttpError } from './auth.errors.js'
import type { AuthenticatedPrincipal, AuthenticationRequest } from './auth.types.js'
import { DownloadTokenService, downloadPath } from './download-token.service.js'
import { MaxInitDataService } from './max-init-data.service.js'

const singleHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')

const sqliteNow = (): string => new Date().toISOString().slice(0, 19).replace('T', ' ')

@Injectable()
export class AuthenticationService {
  constructor(
    @Inject(UserIdentityRepository) private readonly users: UserIdentityRepository,
    @Inject(MaxInitDataService) private readonly maxInitData: MaxInitDataService,
    @Inject(DownloadTokenService) private readonly downloadTokens: DownloadTokenService,
  ) {}

  async authenticate(
    request: AuthenticationRequest,
    claimedMaxUserId: number,
  ): Promise<AuthenticatedPrincipal> {
    const downloadToken = (request.query as { dl?: unknown } | undefined)?.dl
    if (typeof downloadToken === 'string' && downloadToken) {
      return await this.authenticateDownload(request, downloadToken, claimedMaxUserId)
    }
    const webSession = singleHeader(request.headers['x-web-session']).trim()
    if (webSession) return await this.authenticateWebSession(webSession, claimedMaxUserId)
    return await this.authenticateMax(request, claimedMaxUserId)
  }

  /** Ссылка из `POST /api/downloads/link`: только GET и только тот файл, для которого она выдана. */
  private async authenticateDownload(
    request: AuthenticationRequest,
    token: string,
    claimedMaxUserId: number,
  ): Promise<AuthenticatedPrincipal> {
    const path = downloadPath(String(request.url ?? ''))
    if (
      request.method !== 'GET' ||
      !this.downloadTokens.isDownloadablePath(path) ||
      !this.downloadTokens.verify(token, claimedMaxUserId, path)
    ) {
      throw authHttpError(HttpStatus.UNAUTHORIZED, 'Ссылка на скачивание недействительна или устарела.')
    }
    const user = await this.users.findByMaxUserId(claimedMaxUserId)
    return { provider: 'max', claimedMaxUserId, user }
  }

  private async authenticateWebSession(
    token: string,
    claimedMaxUserId: number,
  ): Promise<AuthenticatedPrincipal> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const now = sqliteNow()
    const user = await this.users.findByWebSessionTokenHash(tokenHash, now)
    if (!user) {
      throw authHttpError(HttpStatus.UNAUTHORIZED, 'Сессия сайта истекла. Войдите снова.')
    }
    if (user.maxUserId !== claimedMaxUserId) {
      throw authHttpError(
        HttpStatus.FORBIDDEN,
        'Сессия сайта не соответствует запрошенному пользователю.',
      )
    }
    await this.users.touchWebSession(tokenHash, now)
    return { provider: 'web-session', claimedMaxUserId, user }
  }

  /**
   * Режим MAX_WEBAPP_AUTH: `strict` требует подписанный initData, `optional` проверяет его при наличии
   * (локальная разработка в браузере), `off` отключает проверку. По умолчанию — `optional` при заданном токене.
   */
  private async authenticateMax(
    request: AuthenticationRequest,
    claimedMaxUserId: number,
  ): Promise<AuthenticatedPrincipal> {
    const botToken = maxBotToken()
    const rawMode = String(process.env.MAX_WEBAPP_AUTH || '').toLowerCase()
    const mode = ['off', 'optional', 'strict'].includes(rawMode)
      ? rawMode
      : botToken
        ? 'optional'
        : 'off'
    const rawInitData = singleHeader(request.headers['x-max-init-data'])

    if (mode !== 'off' && botToken) {
      if (!rawInitData) {
        if (mode === 'strict') {
          throw authHttpError(
            HttpStatus.UNAUTHORIZED,
            'Требуется заголовок X-Max-Init-Data. Откройте мини-приложение из MAX или задайте MAX_WEBAPP_AUTH=optional для разработки.',
          )
        }
      } else {
        const maxAgeSeconds = Number(process.env.MAX_INIT_DATA_MAX_AGE_SEC || 86_400)
        const signedMaxUserId = this.maxInitData.parseAndValidate(
          rawInitData.trim(),
          botToken,
          maxAgeSeconds,
        )
        if (signedMaxUserId == null) {
          throw authHttpError(
            HttpStatus.UNAUTHORIZED,
            'Недействительные или устаревшие данные запуска MAX (initData).',
          )
        }
        if (signedMaxUserId !== claimedMaxUserId) {
          throw authHttpError(HttpStatus.FORBIDDEN, 'max_user_id не совпадает с подписью MAX.')
        }
      }
    }

    const user = await this.users.findByMaxUserId(claimedMaxUserId)
    return { provider: 'max', claimedMaxUserId, user }
  }
}
