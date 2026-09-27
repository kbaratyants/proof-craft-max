import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import multipart from '@fastify/multipart'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module.js'
import { createTestDatabase } from './support/test-database.js'
import { getMultipartOptions } from '../src/common/multipart-options.js'

const botToken = '123456:nest-chat-read-token'
const studentMaxUserId = 9401
const secondStudentMaxUserId = 9402
const teacherMaxUserId = 9403
const unassignedTeacherMaxUserId = 9404
const adminMaxUserId = 9405
const guestMaxUserId = 9406
const unknownMaxUserId = 9499
const studentWebSession = 'nest-chat-read-web-session'
const chatFileBody = 'chat attachment body'

type FixtureIds = {
  studentId: number
  secondStudentId: number
  studentTextMessageId: number
  teacherFileMessageId: number
  adminMessageId: number
  systemMessageId: number
  guestMessageId: number
}

let temporaryRoot: string
let databasePath: string
let app: NestFastifyApplication
let fixtureIds: FixtureIds

const buildMaxInitData = (maxUserId: number): string => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `chat-read-${maxUserId}`,
    user: JSON.stringify({ id: maxUserId, first_name: 'Chat' }),
  })
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set(
    'hash',
    crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'),
  )
  return params.toString()
}

const authHeaders = (maxUserId: number): Record<string, string> => ({
  'x-max-init-data': buildMaxInitData(maxUserId),
})

const multipartMessage = (
  fields: Record<string, string | number>,
  file?: { content: string; filename: string; contentType: string },
): { headers: Record<string, string>; payload: Buffer } => {
  const boundary = `proof-craft-${crypto.randomUUID()}`
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ))
  }
  if (file) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
      `Content-Type: ${file.contentType}\r\n\r\n${file.content}\r\n`,
    ))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  }
}

const seedChatReads = (databasePath: string): FixtureIds => {
  const db = new Database(databasePath)
  const uploadsDirectory = join(dirname(databasePath), 'uploads')
  mkdirSync(uploadsDirectory, { recursive: true })
  const chatFilePath = 'chat-read.txt'
  writeFileSync(join(uploadsDirectory, chatFilePath), chatFileBody)

  const insertUser = db.prepare(`
    INSERT INTO users (max_user_id, username, first_name, last_name, role)
    VALUES (?, ?, ?, ?, ?)
  `)
  const studentUserId = Number(
    insertUser.run(
      studentMaxUserId,
      'anna',
      'Анна',
      'Ученица',
      'student',
    ).lastInsertRowid,
  )
  const secondStudentUserId = Number(
    insertUser.run(secondStudentMaxUserId, 'boris', 'Борис', 'Ученик', 'student')
      .lastInsertRowid,
  )
  const teacherUserId = Number(
    insertUser.run(teacherMaxUserId, 'teacher', 'Ирина', 'Преподаватель', 'teacher')
      .lastInsertRowid,
  )
  const unassignedTeacherUserId = Number(
    insertUser.run(
      unassignedTeacherMaxUserId,
      'other_teacher',
      'Ольга',
      'Преподаватель',
      'teacher',
    ).lastInsertRowid,
  )
  const adminUserId = Number(
    insertUser.run(adminMaxUserId, 'admin', 'Админ', 'Тестовый', 'admin')
      .lastInsertRowid,
  )
  const guestUserId = Number(
    insertUser.run(guestMaxUserId, 'helper', null, null, 'guest').lastInsertRowid,
  )
  const insertRole = db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, ?)`)
  for (const [userId, role] of [
    [studentUserId, 'student'],
    [secondStudentUserId, 'student'],
    [teacherUserId, 'teacher'],
    [unassignedTeacherUserId, 'teacher'],
    [adminUserId, 'admin'],
    [guestUserId, 'guest'],
  ] as const) {
    insertRole.run(userId, role)
  }

  const insertStudent = db.prepare(`
    INSERT INTO students (user_id, full_name, phone, lessons_count, status)
    VALUES (?, ?, '+79990000000', 10, 'studying')
  `)
  const studentId = Number(
    insertStudent.run(studentUserId, 'Анна Ученица').lastInsertRowid,
  )
  const secondStudentId = Number(
    insertStudent.run(secondStudentUserId, 'Борис Ученик').lastInsertRowid,
  )
  const teacherId = Number(
    db.prepare(`INSERT INTO teachers (user_id, full_name) VALUES (?, ?)`)
      .run(teacherUserId, 'Ирина Преподаватель').lastInsertRowid,
  )
  db.prepare(`INSERT INTO teachers (user_id, full_name) VALUES (?, ?)`)
    .run(unassignedTeacherUserId, 'Ольга Преподаватель')
  db.prepare(`INSERT INTO student_teachers (student_id, teacher_id) VALUES (?, ?)`)
    .run(studentId, teacherId)

  const insertMessage = db.prepare(`
    INSERT INTO chat_messages
      (student_id, sender_user_id, text_content, content_type, file_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const studentTextMessageId = Number(
    insertMessage.run(
      studentId,
      studentUserId,
      'Сообщение ученика',
      'text',
      null,
      '2026-09-24 10:00:00',
    ).lastInsertRowid,
  )
  const teacherFileMessageId = Number(
    insertMessage.run(
      studentId,
      teacherUserId,
      'Файл преподавателя',
      'document',
      'chat-read.txt',
      '2026-09-24 10:01:00',
    ).lastInsertRowid,
  )
  const adminMessageId = Number(
    insertMessage.run(
      studentId,
      adminUserId,
      'Сообщение администратора',
      'text',
      null,
      '2026-09-24 10:02:00',
    ).lastInsertRowid,
  )
  const systemMessageId = Number(
    insertMessage.run(
      studentId,
      adminUserId,
      'Системное сообщение',
      'system',
      null,
      '2026-09-24 10:03:00',
    ).lastInsertRowid,
  )
  const guestMessageId = Number(
    insertMessage.run(
      studentId,
      guestUserId,
      'Сообщение пользователя',
      'text',
      null,
      '2026-09-24 10:04:00',
    ).lastInsertRowid,
  )
  insertMessage.run(
    secondStudentId,
    secondStudentUserId,
    'Второй чат',
    'text',
    null,
    '2026-09-24 11:00:00',
  )

  db.prepare(`
    INSERT INTO web_sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+1 day'))
  `).run(
    studentUserId,
    crypto.createHash('sha256').update(studentWebSession).digest('hex'),
  )
  db.close()
  return {
    studentId,
    secondStudentId,
    studentTextMessageId,
    teacherFileMessageId,
    adminMessageId,
    systemMessageId,
    guestMessageId,
  }
}

before(async () => {
  const fixture = await createTestDatabase('proof-craft-chat-reads-')
  temporaryRoot = fixture.temporaryRoot
  databasePath = fixture.databasePath
  fixtureIds = seedChatReads(fixture.databasePath)
  process.env.DATABASE_URL = `file:${fixture.databasePath}`
  process.env.MAX_BOT_TOKEN = botToken
  process.env.MAX_WEBAPP_AUTH = 'strict'
  process.env.CHAT_ENABLED = 'true'
  process.env.MAX_HOMEWORK_UPLOAD_MB = '0.001'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.register(multipart, getMultipartOptions())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

after(async () => {
  process.env.CHAT_ENABLED = 'true'
  await app?.close()
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('GET chats/students ограничивает список ролью и исправляет SEC-002', async () => {
  const student = await app.inject({
    method: 'GET',
    url: `/api/chats/students?max_user_id=${studentMaxUserId}`,
    headers: authHeaders(studentMaxUserId),
  })
  assert.equal(student.statusCode, 200)
  const brief = (list: Array<{ id: number; full_name: string; status: string }>) =>
    list.map(({ id, full_name, status }) => ({ id, full_name, status }))
  assert.equal(student.json().ok, true)
  assert.deepEqual(brief(student.json().data.students), [
    { id: fixtureIds.studentId, full_name: 'Анна Ученица', status: 'studying' },
  ])
  const own = student.json().data.students[0]
  assert.ok(Array.isArray(own.teachers) && own.teachers.length > 0)
  assert.ok(own.last_message && typeof own.last_message.sender_name === 'string')

  const teacher = await app.inject({
    method: 'GET',
    url: `/api/chats/students?max_user_id=${teacherMaxUserId}`,
    headers: authHeaders(teacherMaxUserId),
  })
  assert.equal(teacher.statusCode, 200)
  assert.deepEqual(brief(teacher.json().data.students), [
    { id: fixtureIds.studentId, full_name: 'Анна Ученица', status: 'studying' },
  ])

  const unassignedTeacher = await app.inject({
    method: 'GET',
    url: `/api/chats/students?max_user_id=${unassignedTeacherMaxUserId}`,
    headers: authHeaders(unassignedTeacherMaxUserId),
  })
  assert.equal(unassignedTeacher.statusCode, 200)
  assert.deepEqual(unassignedTeacher.json().data.students, [])

  const admin = await app.inject({
    method: 'GET',
    url: `/api/chats/students?max_user_id=${adminMaxUserId}`,
    headers: authHeaders(adminMaxUserId),
  })
  assert.equal(admin.statusCode, 200)
  // Сортировка по последней активности: порядок зависит от переписки, проверяем состав.
  assert.deepEqual(new Set(brief(admin.json().data.students).map(({ id }) => id)), new Set([fixtureIds.studentId, fixtureIds.secondStudentId]))

  const guest = await app.inject({
    method: 'GET',
    url: `/api/chats/students?max_user_id=${guestMaxUserId}`,
    headers: authHeaders(guestMaxUserId),
  })
  assert.equal(guest.statusCode, 200)
  assert.deepEqual(guest.json().data.students, [])
})

test('GET chats/messages возвращает последние сообщения по возрастанию с маппингом ролей', async () => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/chats/messages?max_user_id=${studentMaxUserId}&student_id=${fixtureIds.studentId}`,
    headers: authHeaders(studentMaxUserId),
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json().data.messages, [
    {
      id: fixtureIds.studentTextMessageId,
      student_id: fixtureIds.studentId,
      sender_user_id: response.json().data.messages[0].sender_user_id,
      sender_name: 'Анна Ученица',
      sender_role: 'ученик',
      sender_role_key: 'student',
      sender_role_color: 'var(--gold)',
      sender_max_user_id: studentMaxUserId,
      text_content: 'Сообщение ученика',
      content_type: 'text',
      has_file: false,
      created_at: '2026-09-24 10:00:00',
    },
    {
      id: fixtureIds.teacherFileMessageId,
      student_id: fixtureIds.studentId,
      sender_user_id: response.json().data.messages[1].sender_user_id,
      sender_name: 'Ирина Преподаватель',
      sender_role: 'преподаватель',
      sender_role_key: 'teacher',
      sender_role_color: 'var(--success)',
      sender_max_user_id: teacherMaxUserId,
      text_content: 'Файл преподавателя',
      content_type: 'document',
      has_file: true,
      created_at: '2026-09-24 10:01:00',
    },
    {
      id: fixtureIds.adminMessageId,
      student_id: fixtureIds.studentId,
      sender_user_id: response.json().data.messages[2].sender_user_id,
      sender_name: 'Админ Тестовый',
      sender_role: 'админ',
      sender_role_key: 'admin',
      sender_role_color: 'var(--danger)',
      sender_max_user_id: adminMaxUserId,
      text_content: 'Сообщение администратора',
      content_type: 'text',
      has_file: false,
      created_at: '2026-09-24 10:02:00',
    },
    {
      id: fixtureIds.systemMessageId,
      student_id: fixtureIds.studentId,
      sender_user_id: response.json().data.messages[3].sender_user_id,
      sender_name: 'Система',
      sender_role: 'система',
      sender_role_key: 'system',
      sender_role_color: 'var(--dim)',
      sender_max_user_id: adminMaxUserId,
      text_content: 'Системное сообщение',
      content_type: 'system',
      has_file: false,
      created_at: '2026-09-24 10:03:00',
    },
    {
      id: fixtureIds.guestMessageId,
      student_id: fixtureIds.studentId,
      sender_user_id: response.json().data.messages[4].sender_user_id,
      sender_name: '@helper',
      sender_role: 'пользователь',
      sender_role_key: 'user',
      sender_role_color: 'var(--gold)',
      sender_max_user_id: guestMaxUserId,
      text_content: 'Сообщение пользователя',
      content_type: 'text',
      has_file: false,
      created_at: '2026-09-24 10:04:00',
    },
  ])

  const limited = await app.inject({
    method: 'GET',
    url: `/api/chats/messages?max_user_id=${studentMaxUserId}&student_id=${fixtureIds.studentId}&limit=2`,
    headers: authHeaders(studentMaxUserId),
  })
  assert.equal(limited.statusCode, 200)
  assert.deepEqual(
    limited.json().data.messages.map((message: { id: number }) => message.id),
    [fixtureIds.systemMessageId, fixtureIds.guestMessageId],
  )
})

test('GET chats/messages применяет общую матрицу доступа', async () => {
  const assigned = await app.inject({
    method: 'GET',
    url: `/api/chats/messages?max_user_id=${teacherMaxUserId}&student_id=${fixtureIds.studentId}`,
    headers: authHeaders(teacherMaxUserId),
  })
  assert.equal(assigned.statusCode, 200)

  for (const maxUserId of [unassignedTeacherMaxUserId, secondStudentMaxUserId]) {
    const denied = await app.inject({
      method: 'GET',
      url: `/api/chats/messages?max_user_id=${maxUserId}&student_id=${fixtureIds.studentId}`,
      headers: authHeaders(maxUserId),
    })
    assert.equal(denied.statusCode, 403)
    assert.deepEqual(denied.json(), {
      ok: false,
      error: 'Нет доступа к чату этого ученика.',
    })
  }

  const admin = await app.inject({
    method: 'GET',
    url: `/api/chats/messages?max_user_id=${adminMaxUserId}&student_id=${fixtureIds.secondStudentId}`,
    headers: authHeaders(adminMaxUserId),
  })
  assert.equal(admin.statusCode, 200)
})

test('chat reads поддерживают web-session, MAX initData и nginx-пути', async () => {
  const web = await app.inject({
    method: 'GET',
    url: `/chats/messages?max_user_id=${studentMaxUserId}&student_id=${fixtureIds.studentId}&limit=1`,
    headers: { 'x-web-session': studentWebSession },
  })
  assert.equal(web.statusCode, 200)
  assert.deepEqual(web.json().data.messages.map((message: { id: number }) => message.id), [
    fixtureIds.guestMessageId,
  ])

  const max = await app.inject({
    method: 'GET',
    url: `/chats/students?max_user_id=${studentMaxUserId}`,
    headers: authHeaders(studentMaxUserId),
  })
  assert.equal(max.statusCode, 200)
  assert.deepEqual(max.json().data.students.map((student: { id: number }) => student.id), [
    fixtureIds.studentId,
  ])
})

test('GET chat message file использует общий storage boundary и матрицу доступа', async () => {
  for (const maxUserId of [studentMaxUserId, teacherMaxUserId, adminMaxUserId]) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/messages/${fixtureIds.teacherFileMessageId}/file?max_user_id=${maxUserId}`,
      headers: authHeaders(maxUserId),
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'application/octet-stream')
    assert.equal(response.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.equal(response.body, chatFileBody)
  }

  const web = await app.inject({
    method: 'GET',
    url: `/chats/messages/${fixtureIds.teacherFileMessageId}/file?max_user_id=${studentMaxUserId}`,
    headers: { 'x-web-session': studentWebSession },
  })
  assert.equal(web.statusCode, 200)
  assert.equal(web.body, chatFileBody)

  for (const maxUserId of [unassignedTeacherMaxUserId, secondStudentMaxUserId]) {
    const denied = await app.inject({
      method: 'GET',
      url: `/api/chats/messages/${fixtureIds.teacherFileMessageId}/file?max_user_id=${maxUserId}`,
      headers: authHeaders(maxUserId),
    })
    assert.equal(denied.statusCode, 403)
    assert.deepEqual(denied.json(), {
      ok: false,
      error: 'Нет доступа к этому вложению.',
    })
  }
})

test('chat reads сохраняют validation, auth, not-found и disabled ошибки', async (context) => {
  await context.test('query валидируется до credential', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/messages?max_user_id=${studentMaxUserId}&student_id=nope`,
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), {
      ok: false,
      error: 'Некорректные параметры запроса.',
    })
  })

  await context.test('file id валидируется до credential', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/messages/nope/file?max_user_id=${studentMaxUserId}`,
    })
    assert.equal(response.statusCode, 400)
  })

  await context.test('нет credential', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/students?max_user_id=${studentMaxUserId}`,
    })
    assert.equal(response.statusCode, 401)
  })

  await context.test('подписанный пользователь не найден', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/students?max_user_id=${unknownMaxUserId}`,
      headers: authHeaders(unknownMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Пользователь не найден.' })
  })

  await context.test('несуществующее сообщение', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/messages/999999/file?max_user_id=${studentMaxUserId}`,
      headers: authHeaders(studentMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Сообщение не найдено.' })
  })

  await context.test('сообщение без вложения', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/messages/${fixtureIds.studentTextMessageId}/file?max_user_id=${studentMaxUserId}`,
      headers: authHeaders(studentMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Вложение недоступно.' })
  })

  await context.test('CHAT_ENABLED проверяется раньше параметров и auth', async () => {
    process.env.CHAT_ENABLED = 'false'
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/chats/messages?student_id=nope',
      })
      assert.equal(response.statusCode, 503)
      assert.deepEqual(response.json(), {
        ok: false,
        error: 'Чаты временно отключены.',
      })
    } finally {
      process.env.CHAT_ENABLED = 'true'
    }
  })
})

test('POST chats/messages атомарно создаёт текст и уведомление преподавателю', async () => {
  const body = multipartMessage({
    max_user_id: studentMaxUserId,
    student_id: fixtureIds.studentId,
    text_content: '  Новое сообщение ученика  ',
  })
  const response = await app.inject({
    method: 'POST',
    url: '/api/chats/messages',
    headers: { ...body.headers, ...authHeaders(studentMaxUserId) },
    payload: body.payload,
  })
  assert.equal(response.statusCode, 200)
  const message = response.json().data.message
  assert.equal(message.student_id, fixtureIds.studentId)
  assert.equal(message.text_content, 'Новое сообщение ученика')
  assert.equal(message.content_type, 'text')
  assert.equal(message.sender_role_key, 'student')
  assert.equal(message.has_file, false)

  const db = new Database(databasePath, { readonly: true })
  const notification = db.prepare(`
    SELECT n.kind, n.body, n.payload
    FROM app_notifications n
    JOIN users u ON u.id = n.user_id
    WHERE u.max_user_id = ?
    ORDER BY n.id DESC LIMIT 1
  `).get(teacherMaxUserId)
  db.close()
  assert.deepEqual(notification, {
    kind: 'chat_message',
    body: 'В чате ученика Анна Ученица новое сообщение.',
    payload: JSON.stringify({ student_id: fixtureIds.studentId, message_id: message.id }),
  })
})

test('POST chats/messages сохраняет нормализованное вложение и уведомляет ученика', async () => {
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'
  const body = multipartMessage(
    {
      max_user_id: teacherMaxUserId,
      student_id: fixtureIds.studentId,
      text_content: 'Фото преподавателя',
    },
    { content: image, filename: '../../unsafe.svg', contentType: 'image/svg+xml' },
  )
  const response = await app.inject({
    method: 'POST',
    url: '/chats/messages',
    headers: { ...body.headers, ...authHeaders(teacherMaxUserId) },
    payload: body.payload,
  })
  assert.equal(response.statusCode, 200)
  const message = response.json().data.message
  assert.equal(message.content_type, 'photo')
  assert.equal(message.has_file, true)

  const db = new Database(databasePath, { readonly: true })
  const stored = db.prepare('SELECT file_id FROM chat_messages WHERE id = ?').get(message.id) as {
    file_id: string
  }
  const notification = db.prepare(`
    SELECT n.body, n.payload
    FROM app_notifications n
    JOIN users u ON u.id = n.user_id
    WHERE u.max_user_id = ?
    ORDER BY n.id DESC LIMIT 1
  `).get(studentMaxUserId)
  db.close()
  assert.equal(existsSync(join(dirname(databasePath), 'uploads', stored.file_id)), true)
  assert.equal(stored.file_id.endsWith('.jpg'), true)
  assert.deepEqual(notification, {
    body: 'Новое сообщение в вашем чате от преподавателя.',
    payload: JSON.stringify({ student_id: fixtureIds.studentId, message_id: message.id }),
  })
})

test('POST chats/messages исправляет SEC-002 и очищает файл при отказе', async () => {
  const uploads = join(dirname(databasePath), 'uploads')
  const beforeFiles = readdirSync(uploads).sort()
  const body = multipartMessage(
    {
      max_user_id: unassignedTeacherMaxUserId,
      student_id: fixtureIds.studentId,
      text_content: 'Запрещённое сообщение',
    },
    { content: 'attachment', filename: 'denied.txt', contentType: 'text/plain' },
  )
  const response = await app.inject({
    method: 'POST',
    url: '/api/chats/messages',
    headers: { ...body.headers, ...authHeaders(unassignedTeacherMaxUserId) },
    payload: body.payload,
  })
  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.json(), {
    ok: false,
    error: 'Нет доступа к чату этого ученика.',
  })
  assert.deepEqual(readdirSync(uploads).sort(), beforeFiles)
})

test('POST chats/messages сохраняет validation и очищает oversized upload', async (context) => {
  await context.test('пустое сообщение', async () => {
    const body = multipartMessage({
      max_user_id: studentMaxUserId,
      student_id: fixtureIds.studentId,
      text_content: '   ',
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/chats/messages',
      headers: { ...body.headers, ...authHeaders(studentMaxUserId) },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { ok: false, error: 'Добавьте текст или вложение.' })
  })

  await context.test('слишком большой файл', async () => {
    const uploads = join(dirname(databasePath), 'uploads')
    const beforeFiles = readdirSync(uploads).sort()
    const body = multipartMessage(
      { max_user_id: studentMaxUserId, student_id: fixtureIds.studentId },
      { content: 'x'.repeat(2_048), filename: 'large.txt', contentType: 'text/plain' },
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/chats/messages',
      headers: { ...body.headers, ...authHeaders(studentMaxUserId) },
      payload: body.payload,
    })
    assert.equal(response.statusCode, 413)
    assert.deepEqual(response.json(), {
      ok: false,
      error: 'Файл слишком большой. Максимум 0 МБ.',
    })
    assert.deepEqual(readdirSync(uploads).sort(), beforeFiles)
  })
})

test('непрочитанные: счётчик по чату, отметка прочтения и новые сообщения', async () => {
  const unreadFor = async (maxUserId: number) => {
    const response = await app.inject({ method: 'GET', url: `/api/chats/students?max_user_id=${maxUserId}`, headers: authHeaders(maxUserId) })
    const thread = response.json().data.students.find((s: { id: number }) => s.id === fixtureIds.studentId)
    return thread?.unread_count as number
  }
  const markRead = async (maxUserId: number) =>
    await app.inject({
      method: 'POST',
      url: '/api/chats/read',
      headers: { ...authHeaders(maxUserId), 'content-type': 'application/json' },
      payload: { max_user_id: maxUserId, student_id: fixtureIds.studentId },
    })

  assert.ok((await unreadFor(teacherMaxUserId)) > 0)
  assert.equal((await markRead(teacherMaxUserId)).statusCode, 200)
  assert.equal(await unreadFor(teacherMaxUserId), 0)

  const studentUnreadBefore = await unreadFor(studentMaxUserId)
  const body = multipartMessage({ max_user_id: studentMaxUserId, student_id: fixtureIds.studentId, text_content: 'Новый вопрос' })
  const sent = await app.inject({
    method: 'POST',
    url: '/api/chats/messages',
    headers: { ...authHeaders(studentMaxUserId), ...body.headers },
    payload: body.payload,
  })
  assert.equal(sent.statusCode, 200, sent.body)
  assert.equal(await unreadFor(teacherMaxUserId), 1)
  assert.ok((await unreadFor(adminMaxUserId)) >= 1)
  // Своё сообщение автору непрочитанным не считается.
  assert.equal(await unreadFor(studentMaxUserId), studentUnreadBefore)

  assert.equal((await markRead(unassignedTeacherMaxUserId)).statusCode, 403)
})
