import { Module } from '@nestjs/common'
import { HealthModule } from './health/health.module.js'
import { NotificationsModule } from './notifications/notifications.module.js'
import { SessionModule } from './session/session.module.js'

@Module({
  imports: [
    HealthModule,
    NotificationsModule,
    SessionModule,
  ],
})
export class AppModule {}
