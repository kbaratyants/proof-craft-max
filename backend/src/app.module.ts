import { Module } from '@nestjs/common'
import { HealthModule } from './health/health.module.js'
import { NotificationsModule } from './notifications/notifications.module.js'
import { PublicPortfolioModule } from './public-portfolio/public-portfolio.module.js'
import { RegistrationModule } from './registration/registration.module.js'
import { SessionModule } from './session/session.module.js'
import { StudentHomeworksModule } from './student-homeworks/student-homeworks.module.js'

@Module({
  imports: [
    HealthModule,
    NotificationsModule,
    PublicPortfolioModule,
    RegistrationModule,
    SessionModule,
    StudentHomeworksModule,
  ],
})
export class AppModule {}
