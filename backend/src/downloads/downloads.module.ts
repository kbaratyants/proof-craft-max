import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { DownloadLinkController } from './download-link.controller.js'

@Module({
  imports: [AuthModule],
  controllers: [DownloadLinkController],
})
export class DownloadsModule {}
