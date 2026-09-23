import crypto from 'node:crypto'
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common'
import { invalidParameters } from '../common/invalid-parameters.error.js'
import { sqliteTimestamp } from '../common/sqlite-timestamp.js'
import { UserIdentityRepository } from '../persistence/users/user-identity.repository.js'
import { WebAuthRepository } from './web-auth.repository.js'

const LOGIN_TTL_MINUTES = 15
const SESSION_TTL_DAYS = 14
const MINUTE = 60_000

const fail = (status: HttpStatus, error: string): HttpException => new HttpException({ ok: false, error }, status)
const hash = (token: string): string => crypto.createHash('sha256').update(token, 'utf8').digest('hex')
const newOpaqueToken = (): string => crypto.randomBytes(32).toString('base64url')

/**
 * Вход на обычный сайт через подтверждение в боте MAX.
 * Подтверждение пишет бот по ссылке `?start=webauth_<token>`; здесь — запуск, опрос,
 * выход и проверка web-сессии. В БД хранятся только SHA-256 хэши токенов.
 */
@Injectable()
export class WebAuthUseCases {
  constructor(
    @Inject(WebAuthRepository) private readonly webAuth: WebAuthRepository,
    @Inject(UserIdentityRepository) private readonly users: UserIdentityRepository,
  ) {}

  async start(rawBody: unknown): Promise<object> {
    const provider = (rawBody as { provider?: unknown } | null)?.provider
    if (provider !== 'max') return invalidParameters()
    const botUsername = String(process.env.MAX_BOT_USERNAME || '').replace(/^@/, '').trim()
    if (!botUsername) {
      throw fail(HttpStatus.SERVICE_UNAVAILABLE, 'Вход через MAX ещё не настроен на сервере.')
    }
    const token = newOpaqueToken()
    const now = Date.now()
    await this.webAuth.createLoginRequest(
      provider,
      hash(token),
      sqliteTimestamp(now + LOGIN_TTL_MINUTES * MINUTE),
      sqliteTimestamp(now),
    )
    const handoffUrl = `https://max.ru/${encodeURIComponent(botUsername)}?start=webauth_${token}`
    return { ok: true, data: { token, handoff_url: handoffUrl, expires_in_seconds: LOGIN_TTL_MINUTES * 60 } }
  }

  async status(rawToken: unknown): Promise<object> {
    if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 200) return invalidParameters()
    const tokenHash = hash(rawToken.trim())
    const now = Date.now()
    const state = await this.webAuth.getLoginState(tokenHash, sqliteTimestamp(now))
    if (state === 'pending') return { ok: true, data: { status: 'pending' } }
    if (state === 'expired') throw fail(HttpStatus.GONE, 'Время подтверждения входа истекло. Начните заново.')
    const sessionToken = newOpaqueToken()
    const session = await this.webAuth.consumeLoginRequest(
      tokenHash,
      hash(sessionToken),
      sqliteTimestamp(now + SESSION_TTL_DAYS * 24 * 60 * MINUTE),
      sqliteTimestamp(now),
    )
    if (!session) throw fail(HttpStatus.CONFLICT, 'Вход уже завершён в другой вкладке.')
    return { ok: true, data: { status: 'approved', session_token: sessionToken, max_user_id: session.maxUserId } }
  }

  async logout(sessionToken: string): Promise<{ ok: true }> {
    const token = sessionToken.trim()
    if (token) await this.webAuth.deleteSession(hash(token))
    return { ok: true }
  }

  async session(sessionToken: string): Promise<object> {
    const tokenHash = hash(sessionToken.trim())
    const now = sqliteTimestamp()
    const user = await this.users.findByWebSessionTokenHash(tokenHash, now)
    if (!user) throw fail(HttpStatus.UNAUTHORIZED, 'Сессия сайта истекла. Войдите снова.')
    await this.users.touchWebSession(tokenHash, now)
    return { ok: true, data: { max_user_id: user.maxUserId } }
  }
}
