import { Module } from '@nestjs/common'
import { PersistenceModule } from '../persistence/persistence.module.js'
import { AuthenticationGuard } from './authentication.guard.js'
import { AuthenticationService } from './authentication.service.js'
import { MaxInitDataService } from './max-init-data.service.js'
import { RolesGuard } from './roles.guard.js'

@Module({
  imports: [PersistenceModule],
  providers: [AuthenticationService, AuthenticationGuard, RolesGuard, MaxInitDataService],
  exports: [AuthenticationService, AuthenticationGuard, RolesGuard],
})
export class AuthModule {}
