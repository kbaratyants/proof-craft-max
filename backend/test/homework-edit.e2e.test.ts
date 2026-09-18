import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import multipart from '@fastify/multipart'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { AppModule } from '../src/app.module.js'
import { getMultipartOptions } from '../src/common/multipart-options.js'
import { createTestDatabase } from './support/test-database.js'

const botToken = '123456:nest-edit-token'
const users = { student: 9301, other: 9302 }
const imageSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>'

let temporaryRoot: string
let databasePath: string
let app: NestFastifyApplication
const ids = { studentId: 0, otherStudentId: 0 }
const paths = { primary: '', keep: '', remove: '' }

const buildMaxInitData = (maxUserId: number): string => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `edit-${maxUserId}`,
    user: JSON.stringify({ id: maxUserId, first_name: 'Edit' }),
  })
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'))
  return params.toString()
}

const patchHomework = async (
  homeworkId: number | string,
  maxUserId: number | null,
  fields: Record<string, string | number>,
  files: Array<{ content: string; filename: string; contentType: string }> = [],
) => {
  const boundary = `proof-craft-${crypto.randomUUID()}`
  const chunks: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  for (const file of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n${file.content}\r\n`,
    ))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return await app.inject({
    method: 'PATCH',
    url: `/api/student/homeworks/${homeworkId}`,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      ...(maxUserId == null ? {} : { 'x-max-init-data': buildMaxInitData(maxUserId) }),
    },
    payload: Buffer.concat(chunks),
  })
}

const createEditableHomework = (studentId = ids.studentId, status = 'pending') => {
  const db = new Database(databasePath)
  const homeworkId = Number(db.prepare(`
    INSERT INTO homeworks (student_id, lesson_number, is_bonus, content_type, file_id, text_content, status, haircut_name, created_at, updated_at)
    VALUES (?, 8, 0, 'photo', ?, 'Исходное описание', ?, 'Исходная стрижка', '2026-09-24 09:00:00', '2026-09-24 09:00:00')
  `).run(studentId, paths.primary, status).lastInsertRowid)
  const insertFile = db.prepare(`INSERT INTO homework_files (homework_id, file_id, content_type, sort_order) VALUES (?, ?, 'photo', ?)`)
  const keepId = Number(insertFile.run(homeworkId, paths.keep, 1).lastInsertRowid)
  const removeId = Number(insertFile.run(homeworkId, paths.remove, 2).lastInsertRowid)
  db.close()
  return { homeworkId, keepId, removeId }
}

const readState = (homeworkId: number) => {
  const db = new Database(databasePath, { readonly: true })
  const homework = db.prepare('SELECT file_id, text_content, haircut_name, updated_at FROM homeworks WHERE id = ?').get(homeworkId) as Record<string, unknown>
  const files = db.prepare('SELECT id, file_id, content_type, sort_order FROM homework_files WHERE homework_id = ? ORDER BY sort_order').all(homeworkId) as Array<Record<string, unknown>>
  db.close()
  return { homework, files }
}

before(async () => {
  const fixture = await createTestDatabase('proof-craft-edit-')
  temporaryRoot = fixture.temporaryRoot
  databasePath = fixture.databasePath
  const uploads = join(dirname(databasePath), 'uploads')
  mkdirSync(uploads, { recursive: true })
  for (const key of ['primary', 'keep', 'remove'] as const) {
    paths[key] = `${key}.jpg`
    writeFileSync(join(uploads, paths[key]), 'jpeg')
  }
  const db = new Database(databasePath)
  const insertUser = db.prepare(`INSERT INTO users (max_user_id, first_name, last_name, role) VALUES (?, ?, 'User', 'student')`)
  const student = Number(insertUser.run(users.student, 'Анна').lastInsertRowid)
  const other = Number(insertUser.run(users.other, 'Other').lastInsertRowid)
  const addRole = db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'student')`)
  addRole.run(student)
  addRole.run(other)
  const insertStudent = db.prepare(`INSERT INTO students (user_id, full_name, phone, lessons_count, status) VALUES (?, ?, '+79990000000', 10, 'studying')`)
  ids.studentId = Number(insertStudent.run(student, 'Анна Ученица').lastInsertRowid)
  ids.otherStudentId = Number(insertStudent.run(other, 'Other User').lastInsertRowid)
  db.close()

  process.env.DATABASE_URL = `file:${databasePath}`
  process.env.MAX_BOT_TOKEN = botToken
  process.env.MAX_WEBAPP_AUTH = 'strict'
  process.env.MAX_HOMEWORK_UPLOAD_MB = '1'
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.register(multipart, getMultipartOptions())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

after(async () => {
  await app?.close()
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('правка pending-работы меняет поля, удаляет и добавляет фото в формате ответа API', async () => {
  const { homeworkId, keepId, removeId } = createEditableHomework()
  const response = await patchHomework(homeworkId, users.student, {
    max_user_id: users.student,
    haircut_name: '  Новая стрижка ',
    text_content: '',
    remove_primary: '1',
    remove_attachment_ids: JSON.stringify([removeId]),
  }, [{ content: imageSvg, filename: 'new.svg', contentType: 'image/svg+xml' }])
  assert.equal(response.statusCode, 200)
  const homework = response.json().data.homework
  assert.deepEqual(Object.keys(homework), [
    'id', 'student_id', 'lesson_number', 'is_bonus', 'content_type', 'file_id', 'text_content', 'status', 'created_at',
    'updated_at', 'haircut_name', 'revision_student_text', 'revision_student_file_id', 'student_name', 'student_user_id',
    'student_max_user_id', 'has_file', 'extra_files_count', 'attachments',
  ])
  assert.deepEqual({ ...homework, updated_at: 'X', attachments: homework.attachments.map(({ id: _id, ...rest }: { id: number }) => rest) }, {
    id: homeworkId,
    student_id: ids.studentId,
    lesson_number: 8,
    is_bonus: 0,
    content_type: 'photo',
    file_id: null,
    text_content: null,
    status: 'pending',
    created_at: '2026-09-24 09:00:00',
    updated_at: 'X',
    haircut_name: '  Новая стрижка ',
    revision_student_text: null,
    revision_student_file_id: null,
    student_name: 'Анна Ученица',
    student_user_id: homework.student_user_id,
    student_max_user_id: users.student,
    has_file: false,
    extra_files_count: 2,
    attachments: [
      { content_type: 'photo', has_file: true },
      { content_type: 'photo', has_file: true },
    ],
  })
  assert.notEqual(homework.updated_at, '2026-09-24 09:00:00')
  const state = readState(homeworkId)
  const [kept, added] = state.files
  assert.equal(kept?.id, keepId)
  assert.equal(state.files.length, 2)
  assert.equal(added?.sort_order, 2)
  assert.match(String(added?.file_id), /\.jpg$/)
  assert.ok(existsSync(join(dirname(databasePath), 'uploads', paths.remove)))
})

test('без полей текст и название не меняются, некорректный remove_attachment_ids игнорируется', async () => {
  const { homeworkId } = createEditableHomework()
  const response = await patchHomework(homeworkId, users.student, { max_user_id: users.student, remove_attachment_ids: '{broken' })
  assert.equal(response.statusCode, 200)
  const state = readState(homeworkId)
  assert.equal(state.homework.text_content, 'Исходное описание')
  assert.equal(state.homework.haircut_name, 'Исходная стрижка')
  assert.equal(state.homework.file_id, paths.primary)
  assert.equal(state.files.length, 2)
})

test('validation, access и state ошибки', async () => {
  const { homeworkId } = createEditableHomework()
  const cases: Array<[number | string, number | null, Record<string, string | number>, number, string | null, number?]> = [
    ['abc', users.student, { max_user_id: users.student }, 400, 'Некорректные параметры запроса.'],
    [homeworkId, users.student, {}, 400, 'Передайте max_user_id.'],
    [createEditableHomework(ids.otherStudentId).homeworkId, users.student, { max_user_id: users.student }, 404, 'Задание не найдено.'],
    [createEditableHomework(ids.studentId, 'approved').homeworkId, users.student, { max_user_id: users.student }, 403, 'Редактировать можно только задания, ещё не проверенные преподавателем.'],
    [homeworkId, null, { max_user_id: users.student }, 401, null],
    [homeworkId, users.student, { max_user_id: users.student }, 500, 'Внутренняя ошибка сервера.', 6],
  ]
  for (const [id, maxUserId, fields, status, error, fileCount] of cases) {
    const files = Array.from({ length: fileCount ?? 0 }, (_, i) => ({ content: imageSvg, filename: `${i}.svg`, contentType: 'image/svg+xml' }))
    const response = await patchHomework(id, maxUserId, fields, files)
    assert.equal(response.statusCode, status, `${id} ${JSON.stringify(fields)}`)
    if (error) assert.deepEqual(response.json(), { ok: false, error })
  }
  assert.equal(readState(homeworkId).files.length, 2)
})
