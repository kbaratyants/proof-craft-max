import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { ChatModule } from '../chat/chat.module.js'
import { PersistenceModule } from '../persistence/persistence.module.js'
import { PrismaModule } from '../persistence/prisma/prisma.module.js'
import { ProfilesModule } from '../profiles/profiles.module.js'
import { RegistrationModule } from '../registration/registration.module.js'
import { StorageModule } from '../storage/storage.module.js'
import { StudentHomeworksModule } from '../student-homeworks/student-homeworks.module.js'
import { DemoController } from './demo.controller.js'
import { DemoSeedService } from './demo-seed.service.js'
import { DemoSimulationService } from './demo-simulation.service.js'

/** Демо-режим для жюри (DEMO_MODE=true): вход по ролям, демо-академия и эмулятор событий. */
@Module({
  imports: [AuthModule, ChatModule, PersistenceModule, PrismaModule, ProfilesModule, RegistrationModule, StorageModule, StudentHomeworksModule],
  controllers: [DemoController],
  providers: [DemoSeedService, DemoSimulationService],
})
export class DemoModule {}
