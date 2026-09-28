import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { rm } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import type { INestApplicationContext } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module.js'
import { DEMO_ACCOUNTS } from '../src/demo/demo.constants.js'
import { MaxAdapter } from '../src/messenger/max/max.adapter.js'
import { MessengerModule } from '../src/messenger/messenger.module.js'
import { buttonsOf, FakeMax } from './support/fake-max.js'
import { createTestDatabase } from './support/test-database.js'

const botToken = '123456:bot-commands-token'
const people = {
  admin: { id: 9701, first_name: 'Админ' },
  student: { id: 9702, first_name: 'Анна' },
  guest: { id: 9703, first_name: 'Гость' },
  /** Жюри: реальный пользователь MAX без роли в академии. */
  judge: { id: 9704, first_name: 'Жюри' },
}

let temporaryRoot: string
let databasePath: string
let app: NestFastifyApplication
let bot: INestApplicationContext
const max = new FakeMax(botToken)
const mark = () => max.calls.length

const withDb = <T>(fn: (db: Database.Database) => T): T => {
  const db = new Database(databasePath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

/** Подписанные данные запуска мини-приложения MAX для пользователя. */
const initDataFor = (maxUserId: number): string => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `demo-${maxUserId}`,
    user: JSON.stringify({ id: maxUserId, first_name: 'Жюри' }),
  })
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'))
  return params.toString()
}

/** Уведомления уходят в MAX в фоне после ответа API — ждём, пока они дойдут до поддельного сервера. */
const eventually = async (read: () => string[], timeoutMs = 2000): Promise<string[]> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value.length) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return read()
}

const post = async (url: string, payload: object, headers: Record<string, string> = {}) =>
  await app.inject({ method: 'POST', url, payload, headers: { 'content-type': 'application/json', ...headers } })

before(async () => {
  const fixture = await createTestDatabase('proof-craft-bot-commands-')
  temporaryRoot = fixture.temporaryRoot
  databasePath = fixture.databasePath
  withDb((db) => {
    const user = (id: number, name: string, role: string) => {
      const userId = Number(db.prepare(`INSERT INTO users (max_user_id, first_name, role) VALUES (?, ?, ?)`).run(id, name, role).lastInsertRowid)
      db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, ?)`).run(userId, role)
      return userId
    }
    user(people.admin.id, people.admin.first_name, 'admin')
    const studentUser = user(people.student.id, people.student.first_name, 'student')
    const teacherUser = user(9799, 'Вера', 'teacher')
    const teacherId = Number(db.prepare(`INSERT INTO teachers (user_id, full_name) VALUES (?, 'Вера Тестова')`).run(teacherUser).lastInsertRowid)
    const studentId = Number(
      db.prepare(`INSERT INTO students (user_id, full_name, phone, lessons_count, status) VALUES (?, 'Анна Смирнова', '+79990000001', 10, 'studying')`)
        .run(studentUser).lastInsertRowid,
    )
    db.prepare(`INSERT INTO student_teachers (student_id, teacher_id) VALUES (?, ?)`).run(studentId, teacherId)
    const homework = db.prepare(`INSERT INTO homeworks (student_id, lesson_number, is_bonus, content_type, text_content, status) VALUES (?, ?, 0, 'text', 'Работа', ?)`)
    const approved = Number(homework.run(studentId, 1, 'approved').lastInsertRowid)
    homework.run(studentId, 2, 'pending')
    homework.run(studentId, 3, 'revision')
    // Второй ученик Веры: у неё самая длинная очередь, и она первая в /stats.
    const queueUser = user(9798, 'Олег', 'student')
    const queueStudent = Number(
      db.prepare(`INSERT INTO students (user_id, full_name, phone, lessons_count, status) VALUES (?, 'Олег Очередь', '+79990000002', 16, 'studying')`)
        .run(queueUser).lastInsertRowid,
    )
    db.prepare(`INSERT INTO student_teachers (student_id, teacher_id) VALUES (?, ?)`).run(queueStudent, teacherId)
    for (let lesson = 1; lesson <= 9; lesson += 1) homework.run(queueStudent, lesson, 'pending')
    db.prepare(`INSERT INTO homework_reviews (homework_id, teacher_id, rating, comment, status, created_at) VALUES (?, ?, 5, 'Отличная растушёвка', 'approved', '2030-03-01 10:00:00')`)
      .run(approved, teacherId)
  })
  process.env.DATABASE_URL = `file:${databasePath}`
  process.env.MAX_WEBAPP_AUTH = 'strict'
  process.env.MAX_BOT_TOKEN = botToken
  process.env.MAX_BOT_USERNAME = 'academy_bot'
  process.env.DEMO_MODE = 'true'
  process.env.MAX_API_BASE_URL = await max.start()
  process.env.MAX_POLL_TIMEOUT_SEC = '0'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  bot = await NestFactory.createApplicationContext(MessengerModule, { logger: false })
  bot.enableShutdownHooks()
  bot.get(MaxAdapter).start(botToken)
})

after(async () => {
  await bot?.close()
  await app?.close()
  await max.stop()
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('при запуске бот записывает меню команд, в том числе /demo на демо-стенде', async () => {
  // Меню отправляется в фоне при старте — дожидаемся первого обработанного обновления.
  await max.message(people.guest, '/id')
  const call = max.calls.find((c) => c.method === 'me/commands')
  assert.ok(call, 'PATCH /me/commands не вызван')
  const commands = call.body.commands as { name: string; description: string }[]
  assert.deepEqual(commands.map((c) => c.name), ['start', 'app', 'me', 'teacher', 'stats', 'admin', 'id', 'demo', 'help'])
  assert.ok(commands.every((c) => c.description.length > 0))
})

test('/id, /help по роли и подсказка на неизвестную команду', async () => {
  let since = mark()
  await max.message(people.guest, '/id')
  assert.match(max.texts(since, people.guest.id)[0]!, new RegExp(`Ваш ID в MAX: ${people.guest.id}`))

  since = mark()
  await max.message(people.guest, '/help')
  const guestHelp = max.texts(since, people.guest.id)[0]!
  assert.match(guestHelp, /заполните заявку/)
  assert.doesNotMatch(guestHelp, /\/stats|\/teacher|\/me /)

  since = mark()
  await max.message(people.admin, '/help')
  const adminHelp = max.texts(since, people.admin.id)[0]!
  assert.match(adminHelp, /\/stats/)
  assert.match(adminHelp, /\/admin/)

  since = mark()
  await max.message(people.guest, '/unknown')
  assert.deepEqual(max.texts(since, people.guest.id), ['Такой команды нет. Список команд — /help'])
})

test('/me показывает ученику работы, средний балл и последний отзыв', async () => {
  let since = mark()
  await max.message(people.student, '/me')
  const [text] = max.texts(since, people.student.id)
  assert.match(text!, /📊 Анна Смирнова/)
  assert.match(text!, /Работ сдано: 3/)
  assert.match(text!, /Принято: 1 · ⏳ На проверке: 1 · ✏️ На доработке: 1/)
  assert.match(text!, /Средний балл: 5\.0 \(оценок: 1\)/)
  assert.match(text!, /Урок №1, ★★★★★\nВера Тестова: «Отличная растушёвка»/)
  assert.deepEqual(buttonsOf(max.sent(since, people.student.id)[0]), [
    { type: 'open_app', text: 'Открыть мои работы', web_app: 'academy_bot', payload: 'app' },
  ])

  since = mark()
  await max.message(people.guest, '/me')
  assert.match(max.texts(since, people.guest.id)[0]!, /Сводка доступна ученикам академии/)
})

test('/stats — сводка для администратора с кнопками «Напомнить»', async () => {
  let since = mark()
  await max.message(people.student, '/stats')
  assert.deepEqual(max.texts(since, people.student.id), ['Сводка академии доступна администраторам.'])

  since = mark()
  await max.message(people.admin, '/stats')
  const reply = max.sent(since, people.admin.id)[0]
  assert.match(String(reply?.body.text), /📈 Сводка академии/)
  assert.match(String(reply?.body.text), /Очередь проверки:\n• Вера Тестова — 10 работ/)
  const remind = buttonsOf(reply).find((b) => b.text === '🔔 Напомнить: Вера Тестова (10)')
  assert.ok(remind?.payload)

  since = mark()
  await max.press(people.admin, remind.payload)
  assert.equal(max.texts(since, 9799).length, 1)
  assert.match(max.texts(since, 9799)[0]!, /^Администратор напоминает: 10 работ ждут вашей проверки/)
  assert.match(max.texts(since, people.admin.id).at(-1)!, /🔔 Напоминание отправлено: Вера Тестова/)
})

test('вход в демо из MAX: приветствие в чат и уведомления демо зрителю, а не реальным людям', async () => {
  const headers = { 'x-max-init-data': initDataFor(people.judge.id) }
  let since = mark()
  const login = await post('/api/demo/login', { role: 'admin' }, headers)
  assert.equal(login.statusCode, 200, login.body)
  const session = login.json().data as { session_token: string; max_user_id: number; chat_linked: boolean }
  assert.equal(session.chat_linked, true)
  assert.match(max.texts(since, people.judge.id)[0]!, /🧪 Вы в демо-академии: администратор/)

  // Заявку ученика получают все администраторы: демо-админу — зрителю в чат, реальному — ничего.
  since = mark()
  const simulate = await post(
    '/api/demo/simulate',
    { max_user_id: session.max_user_id, action: 'student_application' },
    { ...headers, 'x-web-session': session.session_token },
  )
  assert.equal(simulate.statusCode, 200, simulate.body)
  const forwarded = await eventually(() => max.texts(since, people.judge.id))
  assert.ok(forwarded.length > 0)
  assert.ok(forwarded.every((text) => /^🧪 Демо · уведомление для: .+ \(администратор\)\n\n/.test(text)), forwarded.join('\n'))
  assert.deepEqual(max.texts(since, people.admin.id), [])

  // Та же демо-сессия в обычном браузере (без подписи MAX) в чат ничего не шлёт.
  since = mark()
  await post('/api/demo/simulate', { max_user_id: session.max_user_id, action: 'student_application' }, { 'x-web-session': session.session_token })
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.deepEqual(max.sent(since), [])

  // Поддельная подпись не привязывает чат.
  const forged = await post('/api/demo/login', { role: 'admin' }, { 'x-max-init-data': initDataFor(people.judge.id).replace(/hash=\w+/, 'hash=00') })
  assert.equal(forged.json().data.chat_linked, false)
})

test('жюри в демо: команды бота работают от демо-роли, эмулятор и выход — прямо в чате', async () => {
  await post('/api/demo/login', { role: 'admin' }, { 'x-max-init-data': initDataFor(people.judge.id) })

  let since = mark()
  await max.message(people.judge, '/stats')
  assert.match(max.texts(since, people.judge.id)[0]!, /^🧪 Демо · администратор\n\n📈 Сводка академии/)

  since = mark()
  await max.message(people.judge, '/demo')
  const card = max.sent(since, people.judge.id)[0]
  assert.match(String(card?.body.text), /Вы в демо-академии: администратор/)
  assert.ok(buttonsOf(card).some((b) => b.payload === 'demo_role_teacher'))

  since = mark()
  await max.press(people.judge, 'demo_role_teacher')
  assert.equal(withDb((db) => (db.prepare(`SELECT demo_max_user_id id FROM demo_viewers WHERE viewer_max_user_id = ?`).get(people.judge.id) as { id: number }).id), DEMO_ACCOUNTS.teacher)
  since = mark()
  await max.message(people.judge, '/teacher')
  assert.match(max.texts(since, people.judge.id)[0]!, /📝 Проверить задания/)

  // Ученик демо сдаёт работу — уведомление преподавателю приходит зрителю в чат.
  since = mark()
  await max.press(people.judge, 'demo_sim_homework')
  const notification = /^🧪 Демо · уведомление для: .+ \(преподаватель\)\n\n.+отправил ДЗ/
  await eventually(() => max.texts(since, people.judge.id).filter((text) => notification.test(text)))
  const texts = max.texts(since, people.judge.id)
  assert.ok(texts.some((text) => notification.test(text)), texts.join('\n'))
  assert.ok(texts.some((text) => /^🧪 .+ сдал\(а\) работу/.test(text)), texts.join('\n'))

  since = mark()
  await max.press(people.judge, 'demo_exit')
  assert.match(max.texts(since, people.judge.id).at(-1)!, /Вы вышли из демо в чате/)
  since = mark()
  await max.message(people.judge, '/stats')
  assert.deepEqual(max.texts(since, people.judge.id), ['Сводка академии доступна администраторам.'])
})

test('выход из демо в мини-приложении отвязывает чат', async () => {
  const headers = { 'x-max-init-data': initDataFor(people.judge.id) }
  await post('/api/demo/login', { role: 'student' }, headers)
  const leave = await post('/api/demo/leave', {}, headers)
  assert.deepEqual(leave.json().data, { chat_unlinked: true })
  assert.equal(withDb((db) => db.prepare(`SELECT 1 FROM demo_viewers WHERE viewer_max_user_id = ?`).get(people.judge.id)), undefined)
})
