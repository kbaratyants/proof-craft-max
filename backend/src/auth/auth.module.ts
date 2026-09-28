import { Module } from '@nestjs/common'
import { PersistenceModule } from '../persistence/persistence.module.js'
import { AuthenticationGuard } from './authentication.guard.js'
import { AuthenticationService } from './authentication.service.js'
import { DownloadTokenService } from './download-token.service.js'
import { MaxInitDataService } from './max-init-data.service.js'
import { RolesGuard } from './roles.guard.js'

@Module({
  imports: [PersistenceModule],
  providers: [AuthenticationService, AuthenticationGuard, RolesGuard, MaxInitDataService, DownloadTokenService],
  exports: [AuthenticationService, AuthenticationGuard, RolesGuard, DownloadTokenService, MaxInitDataService],
})
export class AuthModule {}
