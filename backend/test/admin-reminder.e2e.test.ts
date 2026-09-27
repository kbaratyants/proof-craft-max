import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { rm } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module.js'
import { UserNotificationGateway } from '../src/notifications/user-notification.gateway.js'
import { createTestDatabase } from './support/test-database.js'

const users = { admin: 7101, teacher: 7102, student: 7103, lonely: 7104 }
const sent: Array<{ maxUserId: number; message: string }> = []
const ids = { pending: 0, approved: 0, lonelyPending: 0 }
let temporaryRoot: string
let databasePath: string
let app: NestFastifyApplication

const sessionOf = (maxUserId: number) => `session-${maxUserId}`
const remind = async (homeworkId: number, maxUserId: number) =>
  await app.inject({
    method: 'POST',
    url: `/api/admin/homeworks/${homeworkId}/remind`,
    headers: { 'content-type': 'application/json', 'x-web-session': sessionOf(maxUserId) },
    payload: { max_user_id: maxUserId },
  })

before(async () => {
  const fixture = await createTestDatabase('proof-craft-admin-reminder-')
  temporaryRoot = fixture.temporaryRoot
  databasePath = fixture.databasePath
  const db = new Database(databasePath)
  const user = (maxUserId: number, role: string) => {
    const id = Number(db.prepare(`INSERT INTO users (max_user_id, first_name, role) VALUES (?, 'U', ?)`).run(maxUserId, role).lastInsertRowid)
    db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, ?)`).run(id, role)
    const hash = crypto.createHash('sha256').update(sessionOf(maxUserId)).digest('hex')
    db.prepare(`INSERT INTO web_sessions (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', '+1 day'))`).run(id, hash)
    return id
  }
  user(users.admin, 'admin')
  const teacherUser = user(users.teacher, 'teacher')
  const studentUser = user(users.student, 'student')
  const lonelyUser = user(users.lonely, 'student')
  const teacherId = Number(db.prepare(`INSERT INTO teachers (user_id, full_name) VALUES (?, 'Ирина Соколова')`).run(teacherUser).lastInsertRowid)
  const insertStudent = db.prepare(`INSERT INTO students (user_id, full_name, phone, lessons_count, status) VALUES (?, ?, '+70000000000', 10, 'studying')`)
  const studentId = Number(insertStudent.run(studentUser, 'Анна Смирнова').lastInsertRowid)
  const lonelyId = Number(insertStudent.run(lonelyUser, 'Борис Один').lastInsertRowid)
  db.prepare(`INSERT INTO student_teachers (student_id, teacher_id) VALUES (?, ?)`).run(studentId, teacherId)
  const homework = db.prepare(`INSERT INTO homeworks (student_id, lesson_number, content_type, status, haircut_name, created_at) VALUES (?, ?, 'text', ?, ?, '2026-09-20 10:00:00')`)
  ids.pending = Number(homework.run(studentId, 3, 'pending', 'Фейд').lastInsertRowid)
  ids.approved = Number(homework.run(studentId, 2, 'approved', null).lastInsertRowid)
  ids.lonelyPending = Number(homework.run(lonelyId, 1, 'pending', null).lastInsertRowid)
  db.close()
  process.env.DATABASE_URL = `file:${databasePath}`
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(UserNotificationGateway)
    .useValue({ send: async (maxUserId: number, message: string) => void sent.push({ maxUserId, message }) })
    .compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

after(async () => {
  await app?.close()
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('напоминание уходит преподавателям ученика в приложение и в MAX, пишется аудит', async () => {
  const response = await remind(ids.pending, users.admin)
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { ok: true, data: { notified: ['Ирина Соколова'] } })
  const message = 'Администратор напоминает: работа Анна Смирнова по уроку №3 («Фейд») ждёт проверки с 2026-09-20.'
  assert.deepEqual(sent, [{ maxUserId: users.teacher, message }])
  const db = new Database(databasePath, { readonly: true })
  const notification = db.prepare(`SELECT n.kind, n.body, n.created_at FROM app_notifications n JOIN users u ON u.id = n.user_id WHERE u.max_user_id = ?`).get(users.teacher) as { kind: string; body: string; created_at: string }
  const audit = db.prepare(`SELECT action FROM audit_log ORDER BY id DESC LIMIT 1`).get()
  db.close()
  assert.equal(notification.kind, 'homework_reminder')
  assert.equal(notification.body, message)
  assert.match(notification.created_at, /^\d{4}-\d{2}-\d{2} /)
  assert.deepEqual(audit, { action: 'homework_review_reminder' })
})

test('напоминание: без преподавателя — 409, проверенная работа — 404, не админ — 403', async () => {
  assert.equal((await remind(ids.lonelyPending, users.admin)).statusCode, 409)
  assert.equal((await remind(ids.approved, users.admin)).statusCode, 404)
  assert.equal((await remind(ids.pending, users.teacher)).statusCode, 403)
})

test('аналитика: нагрузка преподавателей, отстающие ученики и активность', async () => {
  const db = new Database(databasePath)
  const userId = Number(db.prepare(`INSERT INTO users (max_user_id, first_name, role) VALUES (7199, 'Idle', 'student')`).run().lastInsertRowid)
  db.prepare(`INSERT INTO students (user_id, full_name, phone, lessons_count, status, created_at) VALUES (?, 'Давно Молчит', '+7', 10, 'studying', datetime('now', '-30 days'))`).run(userId)
  db.close()
  const response = await app.inject({
    method: 'GET',
    url: `/api/admin/analytics?max_user_id=${users.admin}`,
    headers: { 'x-web-session': sessionOf(users.admin) },
  })
  assert.equal(response.statusCode, 200)
  const data = response.json().data
  const irina = data.teachers.find((t: { full_name: string }) => t.full_name === 'Ирина Соколова')
  assert.equal(irina.pending_count, 1)
  assert.equal(irina.students_count, 1)
  assert.equal(irina.oldest_pending_at, '2026-09-20 10:00:00')
  const idle = data.at_risk.find((s: { full_name: string }) => s.full_name === 'Давно Молчит')
  assert.ok(idle, 'ученик без работ за 30 дней — в отстающих')
  assert.match(idle.reasons[0], /не сдал ни одной работы/)
  assert.deepEqual(Object.keys(data.activity.this_week).sort(), ['applications', 'reviewed', 'submitted'])
  assert.ok(data.activity.this_week.applications >= 0)

  const forbidden = await app.inject({ method: 'GET', url: `/api/admin/analytics?max_user_id=${users.teacher}`, headers: { 'x-web-session': sessionOf(users.teacher) } })
  assert.equal(forbidden.statusCode, 403)
})

test('напоминание обо всей очереди преподавателя', async () => {
  const teacherId = (await app.inject({
    method: 'GET',
    url: `/api/admin/analytics?max_user_id=${users.admin}`,
    headers: { 'x-web-session': sessionOf(users.admin) },
  })).json().data.teachers[0].teacher_id as number
  sent.length = 0
  const response = await app.inject({
    method: 'POST',
    url: `/api/admin/teachers/${teacherId}/remind`,
    headers: { 'content-type': 'application/json', 'x-web-session': sessionOf(users.admin) },
    payload: { max_user_id: users.admin },
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().data, { notified: 'Ирина Соколова', pending_count: 1 })
  assert.deepEqual(sent, [{ maxUserId: users.teacher, message: 'Администратор напоминает: 1 работа ждёт вашей проверки, самая ранняя — с 2026-09-20.' }])
})
