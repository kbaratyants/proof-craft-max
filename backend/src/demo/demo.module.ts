import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AuthModule } from '../auth/auth.module.js'
import { PrismaModule } from '../persistence/prisma/prisma.module.js'
import { StorageModule } from '../storage/storage.module.js'
import { DemoController } from './demo.controller.js'
import { DemoCoreModule } from './demo-core.module.js'
import { DemoSeedService } from './demo-seed.service.js'
import { DemoViewerInterceptor } from './demo-viewer.interceptor.js'

/** Демо-режим для жюри (DEMO_MODE=true): вход по ролям, демо-академия и эмулятор событий. */
@Module({
  imports: [AuthModule, DemoCoreModule, PrismaModule, StorageModule],
  controllers: [DemoController],
  providers: [DemoSeedService, { provide: APP_INTERCEPTOR, useClass: DemoViewerInterceptor }],
})
export class DemoModule {}
