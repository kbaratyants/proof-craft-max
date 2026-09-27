import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common'
import { AuthenticationGuard } from '../auth/authentication.guard.js'
import { CurrentPrincipal } from '../auth/current-principal.decorator.js'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { DownloadTokenService, downloadPath } from '../auth/download-token.service.js'

/**
 * Ссылка для `WebApp.downloadFile`: клиент называет файл, к которому у него уже есть доступ,
 * и получает URL с подписью `dl`. Права на сам файл проверяет его обычный контроллер при скачивании.
 */
@Controller(['api/downloads', 'downloads'])
@UseGuards(AuthenticationGuard)
export class DownloadLinkController {
  constructor(@Inject(DownloadTokenService) private readonly tokens: DownloadTokenService) {}

  @Post('link')
  @HttpCode(HttpStatus.OK)
  createLink(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: { path?: unknown },
  ): { url: string } {
    const path = downloadPath(typeof body?.path === 'string' ? body.path : '')
    if (!this.tokens.isDownloadablePath(path)) {
      throw new HttpException({ ok: false, error: 'Этот файл нельзя скачать.' }, HttpStatus.BAD_REQUEST)
    }
    const maxUserId = principal.claimedMaxUserId
    const query = new URLSearchParams({ max_user_id: String(maxUserId), dl: this.tokens.issue(maxUserId, path) })
    return { url: `${path}?${query}` }
  }
}
