import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ChatModule } from '../chat/chat.module.js'
import { PersistenceModule } from '../persistence/persistence.module.js'
import { PrismaModule } from '../persistence/prisma/prisma.module.js'
import { ProfilesModule } from '../profiles/profiles.module.js'
import { RegistrationModule } from '../registration/registration.module.js'
import { StorageModule } from '../storage/storage.module.js'
import { StudentHomeworksModule } from '../student-homeworks/student-homeworks.module.js'
import { DemoSimulationService } from './demo-simulation.service.js'
import { DemoViewersService } from './demo-viewers.service.js'

/** Общая часть демо для API и бота: эмулятор событий и связь жюри в MAX с демо-ролью. Без сида и HTTP. */
@Module({
  imports: [AuthModule, ChatModule, PersistenceModule, PrismaModule, ProfilesModule, RegistrationModule, StorageModule, StudentHomeworksModule],
  providers: [DemoSimulationService, DemoViewersService],
  exports: [DemoSimulationService, DemoViewersService],
})
export class DemoCoreModule {}
