import { Body, Controller, Get, Headers, HttpCode, HttpStatus, HttpException, Inject, Post, UseGuards } from '@nestjs/common'
import type { AuthenticatedPrincipal } from '../auth/auth.types.js'
import { AuthenticationGuard } from '../auth/authentication.guard.js'
import { CurrentPrincipal } from '../auth/current-principal.decorator.js'
import { invalidParameters } from '../common/invalid-parameters.error.js'
import { DEMO_ACCOUNTS, type DemoRole, demoEnabled } from './demo.constants.js'
import { DEMO_ACTIONS, type DemoAction, DemoSimulationService } from './demo-simulation.service.js'
import { DemoViewersService } from './demo-viewers.service.js'

const requireDemo = (): void => {
  if (!demoEnabled()) throw new HttpException({ ok: false, error: 'Демо-режим выключен.' }, HttpStatus.NOT_FOUND)
}

@Controller(['api/demo', 'demo'])
export class DemoController {
  constructor(
    @Inject(DemoSimulationService) private readonly demo: DemoSimulationService,
    @Inject(DemoViewersService) private readonly viewers: DemoViewersService,
  ) {}

  @Get('config')
  config(): object {
    return {
      ok: true,
      data: {
        enabled: demoEnabled(),
        roles: demoEnabled() ? (Object.keys(DEMO_ACCOUNTS) as DemoRole[]) : [],
        actions: demoEnabled() ? DEMO_ACTIONS : [],
      },
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown, @Headers('x-max-init-data') initData?: string): Promise<object> {
    requireDemo()
    const role = (body as { role?: unknown } | null)?.role
    if (typeof role !== 'string' || !(role in DEMO_ACCOUNTS)) return invalidParameters()
    const session = await this.demo.login(role as DemoRole)
    // Вход из мини-приложения MAX: уведомления демо и команды бота будут у этого пользователя в чате.
    const viewer = this.viewers.viewerFromInitData(initData)
    if (viewer) {
      await this.viewers.link(viewer, role as DemoRole)
      await this.viewers.greet(viewer, role as DemoRole)
    }
    return { ok: true, data: { ...session, chat_linked: viewer != null } }
  }

  /** Выход из демо в мини-приложении: бот снова отвечает от реальной учётной записи. */
  @Post('leave')
  @HttpCode(HttpStatus.OK)
  async leave(@Headers('x-max-init-data') initData?: string): Promise<object> {
    requireDemo()
    const viewer = this.viewers.viewerFromInitData(initData)
    if (viewer) await this.viewers.unlink(viewer)
    return { ok: true, data: { chat_unlinked: viewer != null } }
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthenticationGuard)
  async simulate(@CurrentPrincipal() principal: AuthenticatedPrincipal, @Body() body: unknown): Promise<object> {
    requireDemo()
    const action = (body as { action?: unknown } | null)?.action
    if (typeof action !== 'string' || !(DEMO_ACTIONS as readonly string[]).includes(action)) return invalidParameters()
    return { ok: true, data: { message: await this.demo.simulate(principal, action as DemoAction) } }
  }
}
