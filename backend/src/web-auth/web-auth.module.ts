import { Module } from '@nestjs/common'
import { PersistenceModule } from '../persistence/persistence.module.js'
import { PrismaModule } from '../persistence/prisma/prisma.module.js'
import { PrismaWebAuthRepository } from './prisma-web-auth.repository.js'
import { WebAuthController } from './web-auth.controller.js'
import { WebAuthRepository } from './web-auth.repository.js'
import { WebAuthUseCases } from './web-auth.use-cases.js'

@Module({
  imports: [PersistenceModule, PrismaModule],
  controllers: [WebAuthController],
  providers: [WebAuthUseCases, { provide: WebAuthRepository, useClass: PrismaWebAuthRepository }],
  exports: [WebAuthRepository],
})
export class WebAuthModule {}
