import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { rm } from 'node:fs/promises'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import multipart from '@fastify/multipart'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module.js'
import { getMultipartOptions } from '../src/common/multipart-options.js'
import { UserNotificationGateway } from '../src/notifications/user-notification.gateway.js'
import { createTestDatabase } from './support/test-database.js'

const botToken = '123456:nest-revision-token'
const users = { admin: 9201, teacher: 9202, student: 9203, other: 9204, frozen: 9205 }
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>'
const sent: Array<{ maxUserId: number; message: string }> = []

let temporaryRoot: string
let databasePath: string
let app: NestFastifyApplication
const ids = { studentId: 0, otherStudentId: 0, frozenStudentId: 0, pendingHomeworkId: 0 }

const buildMaxInitData = (maxUserId: number): string => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `revision-${maxUserId}`,
    user: JSON.stringify({ id: maxUserId, first_name: 'Revision' }),
  })
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'))
  return params.toString()
}

const multipartBody = (fields: Record<string, string | number>, file?: { content: string; filename: string; contentType: string }) => {
  const boundary = `proof-craft-${crypto.randomUUID()}`
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  if (file) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n${file.content}\r\n`,
    ))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(chunks) }
}

const postRevision = async (
  homeworkId: number | string,
  maxUserId: number | null,
  fields: Record<string, string | number>,
  file?: { content: string; filename: string; contentType: string },
) => {
  const body = multipartBody(fields, file)
  return await app.inject({
    method: 'POST',
    url: `/api/student/homeworks/${homeworkId}/revision`,
    headers: { ...body.headers, ...(maxUserId == null ? {} : { 'x-max-init-data': buildMaxInitData(maxUserId) }) },
    payload: body.payload,
  })
}

const createRevisionHomework = (studentId = ids.studentId, revisionFileId: string | null = null): number => {
  const db = new Database(databasePath)
  const id = Number(db.prepare(`
    INSERT INTO homeworks (student_id, lesson_number, is_bonus, content_type, text_content, status, haircut_name, revision_student_file_id)
    VALUES (?, 7, 0, 'text', 'Работа для исправления', 'revision', 'Андеркат', ?)
  `).run(studentId, revisionFileId).lastInsertRowid)
  db.close()
  return id
}

const readState = (homeworkId: number) => {
  const db = new Database(databasePath, { readonly: true })
  const homework = db.prepare('SELECT status, revision_student_text, revision_student_file_id FROM homeworks WHERE id = ?').get(homeworkId) as {
    status: string
    revision_student_text: string | null
    revision_student_file_id: string | null
  }
  const notifications = db.prepare(`
    SELECT u.max_user_id, n.kind, n.body, n.payload FROM app_notifications n
    JOIN users u ON u.id = n.user_id WHERE n.payload LIKE ? ORDER BY n.id
  `).all(`%"homework_id":${homeworkId}}%`)
  db.close()
  return { homework, notifications }
}

before(async () => {
  const fixture = await createTestDatabase('proof-craft-revision-')
  temporaryRoot = fixture.temporaryRoot
  databasePath = fixture.databasePath
  const db = new Database(databasePath)
  const insertUser = db.prepare(`INSERT INTO users (max_user_id, first_name, last_name, role) VALUES (?, ?, ?, ?)`)
  const addRole = db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)')
  const admin = Number(insertUser.run(users.admin, 'Admin', 'User', 'admin').lastInsertRowid)
  const teacher = Number(insertUser.run(users.teacher, 'Teacher', 'User', 'teacher').lastInsertRowid)
  const student = Number(insertUser.run(users.student, 'Анна', 'Ученица', 'student').lastInsertRowid)
  const other = Number(insertUser.run(users.other, 'Other', 'User', 'student').lastInsertRowid)
  const frozen = Number(insertUser.run(users.frozen, 'Frozen', 'User', 'student').lastInsertRowid)
  addRole.run(admin, 'admin')
  addRole.run(teacher, 'teacher')
  for (const id of [student, other, frozen]) addRole.run(id, 'student')
  const teacherId = Number(db.prepare(`INSERT INTO teachers (user_id, full_name) VALUES (?, 'Teacher User')`).run(teacher).lastInsertRowid)
  const insertStudent = db.prepare(`INSERT INTO students (user_id, full_name, phone, lessons_count, status) VALUES (?, ?, '+79990000000', 10, ?)`)
  ids.studentId = Number(insertStudent.run(student, 'Анна Ученица', 'studying').lastInsertRowid)
  ids.otherStudentId = Number(insertStudent.run(other, 'Other User', 'studying').lastInsertRowid)
  ids.frozenStudentId = Number(insertStudent.run(frozen, 'Frozen User', 'completed').lastInsertRowid)
  db.prepare('INSERT INTO student_teachers (student_id, teacher_id) VALUES (?, ?)').run(ids.studentId, teacherId)
  ids.pendingHomeworkId = Number(db.prepare(`
    INSERT INTO homeworks (student_id, lesson_number, content_type, text_content, status) VALUES (?, 3, 'text', 'На проверке', 'pending')
  `).run(ids.studentId).lastInsertRowid)
  db.close()

  process.env.DATABASE_URL = `file:${databasePath}`
  process.env.MAX_BOT_TOKEN = botToken
  process.env.MAX_WEBAPP_AUTH = 'strict'
  process.env.MAX_HOMEWORK_UPLOAD_MB = '1'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(UserNotificationGateway)
    .useValue({ send: async (maxUserId: number, message: string) => { sent.push({ maxUserId, message }) } })
    .compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.register(multipart, getMultipartOptions())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

after(async () => {
  await app?.close()
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('исправление с фото возвращает работу на проверку и уведомляет команду', async () => {
  const homeworkId = createRevisionHomework()
  sent.length = 0
  const response = await postRevision(homeworkId, users.student, { max_user_id: users.student, revision_text: '  Поправила окантовку  ' }, {
    content: imageSvg,
    filename: 'fix.svg',
    contentType: 'image/svg+xml',
  })
  assert.equal(response.statusCode, 200)
  const homework = response.json().data.homework
  assert.equal(homework.id, homeworkId)
  assert.equal(homework.status, 'pending')
  assert.equal(homework.revision_student_text, 'Поправила окантовку')
  assert.equal(homework.revision_has_file, true)
  assert.deepEqual(Object.keys(homework).sort(), [
    'attachments', 'comments', 'content_type', 'created_at', 'extra_files_count', 'file_id', 'haircut_name',
    'has_file', 'id', 'is_bonus', 'latest_review', 'lesson_number',
    'reviews', 'revision_has_file', 'revision_student_text', 'status',
    'student_id', 'text_content',
  ])
  const state = readState(homeworkId)
  assert.match(String(state.homework.revision_student_file_id), /\.jpg$/)
  assert.ok(existsSync(join(dirname(databasePath), 'uploads', String(state.homework.revision_student_file_id))))
  const text = 'Ученик Анна Ученица отправил исправление по урок №7.'
  const payload = JSON.stringify({ student_id: ids.studentId, homework_id: homeworkId })
  assert.deepEqual(state.notifications, [
    { max_user_id: users.teacher, kind: 'homework_revision', body: text, payload },
    { max_user_id: users.admin, kind: 'homework_revision', body: text, payload },
  ])
  assert.deepEqual(sent, [
    { maxUserId: users.teacher, message: text },
    { maxUserId: users.admin, message: text },
  ])
})

test('исправление без фото сохраняет прежний файл исправления', async () => {
  const homeworkId = createRevisionHomework(ids.studentId, 'revisions/previous-revision.jpg')
  const response = await postRevision(homeworkId, users.student, { max_user_id: users.student, text: 'Только текст' })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().data.homework.revision_student_text, 'Только текст')
  assert.equal(readState(homeworkId).homework.revision_student_file_id, 'revisions/previous-revision.jpg')
})

test('validation, access и state ошибки', async () => {
  const homeworkId = createRevisionHomework()
  const cases: Array<[number | string, number | null, Record<string, string | number>, number, string | null, { content: string; filename: string; contentType: string }?]> = [
    ['abc', users.student, { max_user_id: users.student, text: 'x' }, 400, 'Некорректные параметры запроса.'],
    [homeworkId, users.student, { text: 'x' }, 400, 'Передайте max_user_id.'],
    [homeworkId, users.student, { max_user_id: users.student, text: '   ' }, 400, 'Опишите, что вы исправили.'],
    [homeworkId, users.student, { max_user_id: users.student, text: 'x' }, 400, 'К исправлению можно прикрепить только изображение.', { content: 'text', filename: 'fix.txt', contentType: 'text/plain' }],
    [createRevisionHomework(ids.otherStudentId), users.student, { max_user_id: users.student, text: 'x' }, 404, 'Работа не найдена.'],
    [ids.pendingHomeworkId, users.student, { max_user_id: users.student, text: 'x' }, 400, 'Исправление доступно только для работ со статусом «нужна доработка».'],
    [createRevisionHomework(ids.frozenStudentId), users.frozen, { max_user_id: users.frozen, text: 'x' }, 403, 'Отправка исправлений доступна только ученикам в статусе «обучается».'],
    [homeworkId, null, { max_user_id: users.student, text: 'x' }, 401, null],
  ]
  for (const [id, maxUserId, fields, status, error, file] of cases) {
    const response = await postRevision(id, maxUserId, fields, file)
    assert.equal(response.statusCode, status, `${id} ${JSON.stringify(fields)}`)
    if (error) assert.deepEqual(response.json(), { ok: false, error })
  }
  assert.equal(readState(homeworkId).homework.status, 'revision')
})
