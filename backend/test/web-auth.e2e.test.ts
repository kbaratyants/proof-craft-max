import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { rm } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module.js'
import { createTestDatabase } from './support/test-database.js'

const studentMaxUserId = 9401
const teacherMaxUserId = 9402

let temporaryRoot: string
let databasePath: string
let app: NestFastifyApplication

const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

const withDb = <T>(fn: (db: Database.Database) => T): T => {
  const db = new Database(databasePath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

const start = async (provider: unknown) =>
  await app.inject({ method: 'POST', url: '/api/web-auth/start', headers: { 'content-type': 'application/json' }, payload: { provider } })

const status = async (token: string) => await app.inject({ method: 'GET', url: `/api/web-auth/status?token=${token}` })

const approveLoginAs = (token: string, maxUserId: number) =>
  withDb((db) => db.prepare(`
    UPDATE web_login_requests SET user_id = (SELECT id FROM users WHERE max_user_id = ?), approved_at = datetime('now')
    WHERE token_hash = ?
  `).run(maxUserId, tokenHash(token)))

before(async () => {
  const fixture = await createTestDatabase('proof-craft-web-auth-')
  temporaryRoot = fixture.temporaryRoot
  databasePath = fixture.databasePath
  withDb((db) => {
    const insertUser = db.prepare(`INSERT INTO users (max_user_id, first_name, role) VALUES (?, ?, ?)`)
    const student = Number(insertUser.run(studentMaxUserId, 'Student', 'student').lastInsertRowid)
    const teacher = Number(insertUser.run(teacherMaxUserId, 'Teacher', 'teacher').lastInsertRowid)
    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'student'), (?, 'teacher')`).run(student, teacher)
  })
  process.env.DATABASE_URL = `file:${databasePath}`
  process.env.MAX_BOT_USERNAME = '@nest_academy_bot'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

after(async () => {
  await app?.close()
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('start выдаёт одноразовый токен и ссылку, 400 для неизвестного провайдера, 503 без бота', async () => {
  const max = await start('max')
  assert.equal(max.statusCode, 200)
  const { token, handoff_url: handoff, expires_in_seconds: ttl } = max.json().data
  assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(handoff, `https://max.ru/nest_academy_bot?start=webauth_${token}`)
  assert.equal(ttl, 900)
  const row = withDb((db) => db.prepare(`
    SELECT provider, user_id, (julianday(expires_at) - julianday('now')) * 1440 AS minutes FROM web_login_requests WHERE token_hash = ?
  `).get(tokenHash(token))) as { provider: string; user_id: number | null; minutes: number }
  assert.equal(row.provider, 'max')
  assert.equal(row.user_id, null)
  assert.ok(row.minutes > 14.9 && row.minutes <= 15)
  const invalid = await start('email')
  assert.deepEqual([invalid.statusCode, invalid.json()], [400, { ok: false, error: 'Некорректные параметры запроса.' }])
  const username = process.env.MAX_BOT_USERNAME
  process.env.MAX_BOT_USERNAME = ''
  const unconfigured = await start('max')
  process.env.MAX_BOT_USERNAME = username
  assert.deepEqual([unconfigured.statusCode, unconfigured.json()], [503, { ok: false, error: 'Вход через MAX ещё не настроен на сервере.' }])
})

test('status: pending, approved с выпуском сессии ровно один раз, истёкший и короткий токен', async () => {
  const token = (await start('max')).json().data.token
  const pending = await status(token)
  assert.deepEqual([pending.statusCode, pending.json()], [200, { ok: true, data: { status: 'pending' } }])
  approveLoginAs(token, studentMaxUserId)
  const approved = await status(token)
  assert.equal(approved.statusCode, 200)
  const data = approved.json().data
  assert.equal(data.status, 'approved')
  assert.equal(data.max_user_id, studentMaxUserId)
  assert.match(data.session_token, /^[A-Za-z0-9_-]{43}$/)
  const session = withDb((db) => db.prepare(`
    SELECT u.max_user_id, (julianday(ws.expires_at) - julianday('now')) AS days FROM web_sessions ws JOIN users u ON u.id = ws.user_id WHERE ws.token_hash = ?
  `).get(tokenHash(data.session_token))) as { max_user_id: number; days: number }
  assert.equal(session.max_user_id, studentMaxUserId)
  assert.ok(session.days > 13.99 && session.days <= 14)
  const reused = await status(token)
  assert.deepEqual([reused.statusCode, reused.json()], [410, { ok: false, error: 'Время подтверждения входа истекло. Начните заново.' }])
  const short = await status('short')
  assert.deepEqual([short.statusCode, short.json()], [400, { ok: false, error: 'Некорректные параметры запроса.' }])
})

test('session и logout проверяют и удаляют web-сессию', async () => {
  const token = (await start('max')).json().data.token
  approveLoginAs(token, teacherMaxUserId)
  const sessionToken = (await status(token)).json().data.session_token
  const check = await app.inject({ method: 'GET', url: '/api/web-auth/session', headers: { 'x-web-session': sessionToken } })
  assert.deepEqual([check.statusCode, check.json()], [200, { ok: true, data: { max_user_id: teacherMaxUserId } }])
  const logout = await app.inject({ method: 'POST', url: '/api/web-auth/logout', headers: { 'x-web-session': sessionToken } })
  assert.deepEqual([logout.statusCode, logout.json()], [200, { ok: true }])
  const after = await app.inject({ method: 'GET', url: '/api/web-auth/session', headers: { 'x-web-session': sessionToken } })
  assert.deepEqual([after.statusCode, after.json()], [401, { ok: false, error: 'Сессия сайта истекла. Войдите снова.' }])
  const anonymous = await app.inject({ method: 'POST', url: '/api/web-auth/logout' })
  assert.deepEqual([anonymous.statusCode, anonymous.json()], [200, { ok: true }])
})
