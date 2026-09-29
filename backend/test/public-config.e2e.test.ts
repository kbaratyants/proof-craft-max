import assert from 'node:assert/strict'
import test from 'node:test'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { PublicConfigModule } from '../src/public-config/public-config.module.js'

test('GET /api/public/config отдаёт ник бота без @ и пробелов или null, без авторизации', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [PublicConfigModule] }).compile()
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  const saved = process.env.MAX_BOT_USERNAME
  try {
    process.env.MAX_BOT_USERNAME = '  @academy_bot '
    const configured = await app.inject({ method: 'GET', url: '/api/public/config' })
    assert.equal(configured.statusCode, 200)
    assert.deepEqual(configured.json(), { ok: true, data: { bot_username: 'academy_bot' } })

    delete process.env.MAX_BOT_USERNAME
    const missing = await app.inject({ method: 'GET', url: '/public/config' })
    assert.deepEqual(missing.json(), { ok: true, data: { bot_username: null } })
  } finally {
    if (saved === undefined) delete process.env.MAX_BOT_USERNAME
    else process.env.MAX_BOT_USERNAME = saved
    await app.close()
  }
})
