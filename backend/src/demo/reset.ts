import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { DemoModule } from './demo.module.js'
import { DemoSeedService } from './demo-seed.service.js'

/** Пересоздание демо-академии: `node dist/demo/reset.js` (в Docker — `docker compose exec api node dist/demo/reset.js`). */
const app = await NestFactory.createApplicationContext(DemoModule, { logger: ['error', 'warn', 'log'] })
await app.get(DemoSeedService).reset()
await app.close()
