import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module.js'
import { DEMO_ACCOUNTS } from '../src/demo/demo.constants.js'
import { DemoSeedService } from '../src/demo/demo-seed.service.js'
import { createTestDatabase } from './support/test-database.js'

const realAdminMaxUserId = 5551
/** Запросы к MAX Bot API, которые дошли до поддельного сервера. */
const maxRequests: string[] = []
let maxServer: Server
let temporaryRoot: string
let databasePath: string
let app: NestFastifyApplication

const count = (sql: string): number => {
  const db = new Database(databasePath, { readonly: true })
  try {
    return (db.prepare(sql).get() as { n: number }).n
  } finally {
    db.close()
  }
}
const post = async (url: string, payload: object, headers: Record<string, string> = {}) =>
  await app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', ...headers } })
const login = async (role: string) => (await post('/api/demo/login', { role })).json().data as { session_token: string; max_user_id: number }

before(async () => {
  const fixture = await createTestDatabase('proof-craft-demo-')
  temporaryRoot = fixture.temporaryRoot
  databasePath = fixture.databasePath
  // Реальный администратор: эмулятор не должен отправлять ему сообщения в MAX.
  const db = new Database(databasePath)
  const adminId = Number(db.prepare(`INSERT INTO users (max_user_id, first_name, role) VALUES (?, 'Real', 'admin')`).run(realAdminMaxUserId).lastInsertRowid)
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'admin')`).run(adminId)
  db.close()
  process.env.DATABASE_URL = `file:${databasePath}`
  process.env.MAX_WEBAPP_AUTH = 'strict'
  process.env.MAX_BOT_TOKEN = '123456:demo-token'
  process.env.CHAT_ENABLED = 'true'
  process.env.DEMO_MODE = 'true'
  maxServer = createServer((request, response) => {
    maxRequests.push(String(request.url))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })
  await new Promise<void>((resolve) => maxServer.listen(0, '127.0.0.1', resolve))
  process.env.MAX_API_BASE_URL = `http://127.0.0.1:${(maxServer.address() as AddressInfo).port}`
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

after(async () => {
  await app?.close()
  await new Promise<void>((resolve) => maxServer?.close(() => resolve()) ?? resolve())
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('при старте создаётся демо-академия, повторный запуск её не дублирует', async () => {
  assert.equal(count(`SELECT COUNT(*) n FROM users WHERE max_user_id >= 900000000000000`) > 10, true)
  assert.equal(count(`SELECT COUNT(*) n FROM homeworks WHERE status = 'pending'`), 2)
  assert.equal(count(`SELECT COUNT(*) n FROM teacher_applications WHERE status = 'pending'`), 1)
  const users = count(`SELECT COUNT(*) n FROM users`)
  await app.get(DemoSeedService).onApplicationBootstrap()
  assert.equal(count(`SELECT COUNT(*) n FROM users`), users)
})

test('config описывает роли и действия; вход по роли даёт рабочую web-сессию', async () => {
  const config = (await app.inject({ method: 'GET', url: '/api/demo/config' })).json().data
  assert.deepEqual(config.roles, ['admin', 'teacher', 'student'])
  assert.deepEqual(config.actions, ['homework', 'student_application', 'teacher_application', 'chat_message', 'profile_edit'])
  const expected = { admin: 'isAdmin', teacher: 'isTeacher', student: 'isStudent' } as const
  for (const role of ['admin', 'teacher', 'student'] as const) {
    const session = await login(role)
    assert.equal(session.max_user_id, DEMO_ACCOUNTS[role])
    const me = await app.inject({ method: 'GET', url: `/api/session?max_user_id=${session.max_user_id}`, headers: { 'x-web-session': session.session_token } })
    assert.equal(me.statusCode, 200)
    assert.equal(me.json().data[expected[role]], true)
  }
  const invalid = await post('/api/demo/login', { role: 'root' })
  assert.equal(invalid.statusCode, 400)
})

test('эмулятор создаёт события через обычные use cases и не пишет в MAX', async () => {
  const teacher = await login('teacher')
  const headers = { 'x-web-session': teacher.session_token }
  const before = {
    pending: count(`SELECT COUNT(*) n FROM homeworks WHERE status = 'pending'`),
    moderation: count(`SELECT COUNT(*) n FROM students WHERE status = 'moderation'`),
    applications: count(`SELECT COUNT(*) n FROM teacher_applications WHERE status = 'pending'`),
    chat: count(`SELECT COUNT(*) n FROM chat_messages`),
    edits: count(`SELECT COUNT(*) n FROM student_profile_edits WHERE status = 'pending'`),
    notifications: count(`SELECT COUNT(*) n FROM app_notifications`),
  }
  for (const action of ['homework', 'homework', 'student_application', 'teacher_application', 'chat_message', 'profile_edit']) {
    const response = await post('/api/demo/simulate', { max_user_id: teacher.max_user_id, action }, headers)
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.json().data.message, /\S/)
  }
  assert.equal(count(`SELECT COUNT(*) n FROM homeworks WHERE status = 'pending'`), before.pending + 2)
  assert.equal(count(`SELECT COUNT(*) n FROM students WHERE status = 'moderation'`), before.moderation + 1)
  assert.equal(count(`SELECT COUNT(*) n FROM teacher_applications WHERE status = 'pending'`), before.applications + 1)
  assert.equal(count(`SELECT COUNT(*) n FROM chat_messages`), before.chat + 1)
  assert.equal(count(`SELECT COUNT(*) n FROM student_profile_edits WHERE status = 'pending'`), before.edits + 1)
  assert.ok(count(`SELECT COUNT(*) n FROM app_notifications`) > before.notifications)
  assert.deepEqual(maxRequests, [])
})

test('эмулятор доступен только в демо-сессии', async () => {
  const response = await post('/api/demo/simulate', { max_user_id: realAdminMaxUserId, action: 'homework' })
  assert.equal(response.statusCode, 401)
})

const rows = <T>(sql: string, ...params: unknown[]): T[] => {
  const db = new Database(databasePath)
  try {
    return db.prepare(sql).all(...params) as T[]
  } finally {
    db.close()
  }
}
const run = (sql: string, ...params: unknown[]) => {
  const db = new Database(databasePath)
  try {
    db.prepare(sql).run(...params)
  } finally {
    db.close()
  }
}
/** Ученики демо-преподавателя (под ним входит жюри). */
const demoTeacherStudents = () =>
  rows<{ id: number; lessons_count: number }>(
    `SELECT s.id, s.lessons_count FROM students s
       JOIN student_teachers st ON st.student_id = s.id
       JOIN teachers t ON t.id = st.teacher_id
       JOIN users u ON u.id = t.user_id
      WHERE u.max_user_id = ? AND s.status = 'studying'`,
    DEMO_ACCOUNTS.teacher,
  )
const simulateHomework = async () => {
  const teacher = await login('teacher')
  return await post('/api/demo/simulate', { max_user_id: teacher.max_user_id, action: 'homework' }, { 'x-web-session': teacher.session_token })
}
const lastHomework = () => rows<{ student_id: number; lesson_number: number | null; is_bonus: number }>(`SELECT student_id, lesson_number, is_bonus FROM homeworks ORDER BY id DESC LIMIT 1`)[0]!

test('«Ученик сдаёт работу» выбирает ученика демо-преподавателя, под которым входит жюри', async () => {
  const own = new Set(demoTeacherStudents().map((s) => s.id))
  assert.ok(own.size > 0)
  for (let i = 0; i < 8; i += 1) {
    const response = await simulateHomework()
    assert.equal(response.statusCode, 200, response.body)
    assert.ok(own.has(lastHomework().student_id), `работа ушла ученику ${lastHomework().student_id} не из группы демо-преподавателя`)
  }
})

test('после исчерпания уроков и с висящими доп. заданиями эмулятор сдаёт новый урок сверх программы', async () => {
  const students = demoTeacherStudents()
  for (const student of students) {
    for (let lesson = 1; lesson <= student.lessons_count; lesson += 1) {
      const taken = rows(`SELECT 1 FROM homeworks WHERE student_id = ? AND lesson_number = ? AND status != 'rejected'`, student.id, lesson).length
      if (!taken) run(`INSERT INTO homeworks (student_id, lesson_number, is_bonus, content_type, text_content, status) VALUES (?, ?, 0, 'text', 'занято', 'approved')`, student.id, lesson)
    }
    if (!rows(`SELECT 1 FROM homeworks WHERE student_id = ? AND is_bonus = 1 AND status = 'pending'`, student.id).length) {
      run(`INSERT INTO homeworks (student_id, lesson_number, is_bonus, content_type, text_content, status) VALUES (?, NULL, 1, 'text', 'бонус', 'pending')`, student.id)
    }
  }
  const before = new Map(students.map((s) => [s.id, s.lessons_count]))
  for (let i = 0; i < 3; i += 1) {
    const response = await simulateHomework()
    assert.equal(response.statusCode, 200, response.body)
    const hw = lastHomework()
    const lessonsNow = rows<{ lessons_count: number }>(`SELECT lessons_count FROM students WHERE id = ?`, hw.student_id)[0]!.lessons_count
    assert.ok(before.has(hw.student_id))
    assert.equal(hw.is_bonus, 0)
    assert.equal(hw.lesson_number, lessonsNow)
    assert.equal(lessonsNow, before.get(hw.student_id)! + 1)
    before.set(hw.student_id, lessonsNow)
  }
})

test('без учеников демо-преподавателя работу сдаёт ученик другого преподавателя', async () => {
  const own = demoTeacherStudents().map((s) => s.id)
  run(
    `DELETE FROM student_teachers WHERE teacher_id = (SELECT t.id FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.max_user_id = ?)`,
    DEMO_ACCOUNTS.teacher,
  )
  const response = await simulateHomework()
  assert.equal(response.statusCode, 200, response.body)
  const hw = lastHomework()
  assert.ok(!own.includes(hw.student_id))
  assert.ok(rows(`SELECT 1 FROM student_teachers WHERE student_id = ?`, hw.student_id).length > 0)
})

test('reset пересоздаёт академию из снимка, если он задан', async () => {
  const snapshotPath = join(temporaryRoot, 'snapshot.json')
  await writeFile(snapshotPath, JSON.stringify({
    teachers: [{ key: 't1', firstName: 'Тест', lastName: 'Преподаватель', about: null, demoAccount: true }],
    students: [{ key: 's1', firstName: 'Тест', lastName: 'Ученик', phone: '+79990000000', lessons: 5, status: 'studying', track: 'student', metro: null, about: null, createdAt: '2026-09-01 10:00:00', teacherKeys: ['t1'], demoAccount: true }],
    homeworks: [{
      studentKey: 's1', lesson: 1, isBonus: false, contentType: 'photo', fileKey: 'demo/import/a.jpg', text: 'Работа', status: 'approved', haircut: 'Фейд',
      revisionText: null, createdAt: '2026-09-02 10:00:00', updatedAt: '2026-09-02 10:00:00',
      files: [{ fileKey: 'demo/import/b.jpg', contentType: 'photo', sortOrder: 1 }],
      reviews: [{ teacherKey: 't1', rating: 5, comment: 'Отлично', status: 'approved', createdAt: '2026-09-02 12:00:00' }],
      comments: [{ authorKey: 's1', text: 'Спасибо', createdAt: '2026-09-02 13:00:00' }],
    }],
  }))
  process.env.DEMO_SNAPSHOT_PATH = snapshotPath
  try {
    await app.get(DemoSeedService).reset()
  } finally {
    delete process.env.DEMO_SNAPSHOT_PATH
  }
  assert.equal(count(`SELECT COUNT(*) n FROM students s JOIN users u ON u.id = s.user_id WHERE u.max_user_id >= 900000000000000`), 1)
  assert.equal(count(`SELECT COUNT(*) n FROM homework_reviews`), 1)
  assert.equal(count(`SELECT COUNT(*) n FROM homework_comments`), 1)
  assert.equal(count(`SELECT COUNT(*) n FROM users WHERE max_user_id = 5551`), 1)
  const teacher = await login('teacher')
  const me = await app.inject({ method: 'GET', url: `/api/session?max_user_id=${teacher.max_user_id}`, headers: { 'x-web-session': teacher.session_token } })
  assert.equal(me.json().data.teacher.full_name, 'Тест Преподаватель')
})
