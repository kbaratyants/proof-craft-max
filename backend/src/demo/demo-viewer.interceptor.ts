import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import type { AuthenticationRequest } from '../auth/auth.types.js'
import { withDemoViewer } from './demo.constants.js'

/**
 * Запрос демо-сессии из MAX выполняется в контексте зрителя: уведомления демо-пользователям,
 * которые он вызвал, бот пересылает ему в чат. Принципала заранее выставляет AuthenticationGuard.
 */
@Injectable()
export class DemoViewerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const viewer = context.switchToHttp().getRequest<AuthenticationRequest>()?.authenticatedPrincipal?.demoViewerMaxUserId
    if (!viewer) return next.handle()
    return new Observable((subscriber) => withDemoViewer(viewer, () => next.handle().subscribe(subscriber)))
  }
}
