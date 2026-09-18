import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import { Test } from '@nestjs/testing'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from '../src/app.module.js'
import { createTestDatabase } from './support/test-database.js'

const botToken = '123456:nest-student-homeworks-token'
const webSessionToken = 'nest-student-homeworks-web-session'
const aliceMaxUserId = 8101
const bobMaxUserId = 8102
const teacherMaxUserId = 8201

type FixtureIds = {
  aliceStudent: number
  bobStudent: number
  pendingHomework: number
  approvedHomework: number
  bobHomework: number
  rejectedReview: number
  olderReview: number
  latestReview: number
  studentComment: number
  teacherComment: number
  localAttachment: number
  remoteAttachment: number
  localFile: string
}

let temporaryRoot: string
let app: NestFastifyApplication
let fixtureIds: FixtureIds

const seedStudentHomeworks = (databasePath: string): FixtureIds => {
  const db = new Database(databasePath)
  const uploadsDirectory = join(dirname(databasePath), 'uploads')
  mkdirSync(uploadsDirectory, { recursive: true })
  const localFile = 'student-homework.jpg'
  writeFileSync(join(uploadsDirectory, localFile), 'student homework')

  const insertUser = db.prepare(`
    INSERT INTO users (max_user_id, first_name, last_name, role)
    VALUES (?, ?, ?, ?)
  `)
  const aliceUser = Number(insertUser.run(aliceMaxUserId, 'Алиса', 'Ученица', 'student').lastInsertRowid)
  const bobUser = Number(insertUser.run(bobMaxUserId, 'Борис', 'Ученик', 'student').lastInsertRowid)
  const teacherUser = Number(insertUser.run(teacherMaxUserId, 'Ирина', 'Мастер', 'teacher').lastInsertRowid)
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'student')`).run(aliceUser)
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'student')`).run(bobUser)
  db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, 'teacher')`).run(teacherUser)

  const insertStudent = db.prepare(`
    INSERT INTO students (user_id, full_name, phone, lessons_count, status)
    VALUES (?, ?, '+70000000000', 2, 'studying')
  `)
  const aliceStudent = Number(insertStudent.run(aliceUser, 'Алиса Ученица').lastInsertRowid)
  const bobStudent = Number(insertStudent.run(bobUser, 'Борис Ученик').lastInsertRowid)
  const teacher = Number(
    db.prepare(`INSERT INTO teachers (user_id, full_name) VALUES (?, 'Ирина Мастер')`)
      .run(teacherUser).lastInsertRowid,
  )

  const insertHomework = db.prepare(`
    INSERT INTO homeworks
      (student_id, lesson_number, is_bonus, content_type, file_id, text_content, status,
       haircut_name, revision_student_text, revision_student_file_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const pendingHomework = Number(insertHomework.run(
    aliceStudent,
    2,
    0,
    'photo',
    localFile,
    'Ожидает проверки',
    'pending',
    'Кроп',
    'Исправленная техника',
    'revisions/remote-photo-12345.jpg',
    '2026-01-01 12:00:00',
  ).lastInsertRowid)
  const approvedHomework = Number(insertHomework.run(
    aliceStudent,
    1,
    0,
    'photo',
    localFile,
    'Принятая работа',
    'approved',
    'Фейд',
    null,
    null,
    '2026-02-01 12:00:00',
  ).lastInsertRowid)
  const bobHomework = Number(insertHomework.run(
    bobStudent,
    1,
    1,
    'text',
    null,
    'Чужая работа',
    'approved',
    null,
    null,
    null,
    '2026-03-01 12:00:00',
  ).lastInsertRowid)

  const insertReview = db.prepare(`
    INSERT INTO homework_reviews (homework_id, teacher_id, rating, comment, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const rejectedReview = Number(insertReview.run(
    pendingHomework,
    teacher,
    null,
    'Нужна доработка',
    'rejected',
    '2026-01-01 13:00:00',
  ).lastInsertRowid)
  const olderReview = Number(insertReview.run(
    approvedHomework,
    teacher,
    4,
    'Хорошо',
    'approved',
    '2026-02-01 13:00:00',
  ).lastInsertRowid)
  const latestReview = Number(insertReview.run(
    approvedHomework,
    teacher,
    5,
    'Отлично',
    'approved',
    '2026-02-01 14:00:00',
  ).lastInsertRowid)

  const localAttachment = Number(db.prepare(`
    INSERT INTO homework_files (homework_id, file_id, content_type, sort_order)
    VALUES (?, ?, 'photo', 0)
  `).run(approvedHomework, localFile).lastInsertRowid)
  const remoteAttachment = Number(db.prepare(`
    INSERT INTO homework_files (homework_id, file_id, content_type, sort_order)
    VALUES (?, 'attachments/remote-photo-12345.jpg', 'photo', 1)
  `).run(approvedHomework).lastInsertRowid)
  const studentComment = Number(db.prepare(`
    INSERT INTO homework_comments (homework_id, author_user_id, text_content, created_at)
    VALUES (?, ?, 'Спасибо', '2026-02-01 15:00:00')
  `).run(approvedHomework, aliceUser).lastInsertRowid)
  const teacherComment = Number(db.prepare(`
    INSERT INTO homework_comments (homework_id, author_user_id, text_content, created_at)
    VALUES (?, ?, 'Продолжайте', '2026-02-01 16:00:00')
  `).run(approvedHomework, teacherUser).lastInsertRowid)

  db.prepare(`
    INSERT INTO web_sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+1 day'))
  `).run(aliceUser, crypto.createHash('sha256').update(webSessionToken).digest('hex'))
  db.close()
  return {
    aliceStudent,
    bobStudent,
    pendingHomework,
    approvedHomework,
    bobHomework,
    rejectedReview,
    olderReview,
    latestReview,
    studentComment,
    teacherComment,
    localAttachment,
    remoteAttachment,
    localFile,
  }
}

const buildMaxInitData = (maxUserId: number): string => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `student-homeworks-${maxUserId}`,
    user: JSON.stringify({ id: maxUserId, first_name: 'Student' }),
  })
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'))
  return params.toString()
}

const authHeaders = (maxUserId = aliceMaxUserId): Record<string, string> => ({
  'x-max-init-data': buildMaxInitData(maxUserId),
})

before(async () => {
  const fixture = await createTestDatabase('proof-craft-student-homeworks-')
  temporaryRoot = fixture.temporaryRoot
  fixtureIds = seedStudentHomeworks(fixture.databasePath)
  process.env.DATABASE_URL = `file:${fixture.databasePath}`
  process.env.MAX_BOT_TOKEN = botToken
  process.env.MAX_WEBAPP_AUTH = 'strict'

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

after(async () => {
  await app?.close()
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('GET /api/student/homeworks возвращает полный агрегат только своего ученика', async () => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/student/homeworks?max_user_id=${aliceMaxUserId}`,
    headers: authHeaders(),
  })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), {
    ok: true,
    data: {
      homeworks: [
        {
          id: fixtureIds.pendingHomework,
          student_id: fixtureIds.aliceStudent,
          lesson_number: 2,
          is_bonus: false,
          haircut_name: 'Кроп',
          has_file: true,
          status: 'pending',
          content_type: 'photo',
          file_id: fixtureIds.localFile,
          text_content: 'Ожидает проверки',
          review_count: 1,
          created_at: '2026-01-01 12:00:00',
          revision_student_text: 'Исправленная техника',
          revision_has_file: true,
          reviews: [{
            id: fixtureIds.rejectedReview,
            teacher_id: 1,
            teacher_name: 'Ирина Мастер',
            rating: null,
            comment: 'Нужна доработка',
            status: 'rejected',
            created_at: '2026-01-01 13:00:00',
          }],
          latest_review: {
            id: fixtureIds.rejectedReview,
            teacher_id: 1,
            teacher_name: 'Ирина Мастер',
            rating: null,
            comment: 'Нужна доработка',
            status: 'rejected',
            created_at: '2026-01-01 13:00:00',
          },
          comments: [],
          extra_files_count: 0,
          attachments: [],
        },
        {
          id: fixtureIds.approvedHomework,
          student_id: fixtureIds.aliceStudent,
          lesson_number: 1,
          is_bonus: false,
          haircut_name: 'Фейд',
          has_file: true,
          status: 'approved',
          content_type: 'photo',
          file_id: fixtureIds.localFile,
          text_content: 'Принятая работа',
          review_count: 2,
          created_at: '2026-02-01 12:00:00',
          revision_student_text: null,
          revision_has_file: false,
          reviews: [
            {
              id: fixtureIds.latestReview,
              teacher_id: 1,
              teacher_name: 'Ирина Мастер',
              rating: 5,
              comment: 'Отлично',
              status: 'approved',
              created_at: '2026-02-01 14:00:00',
            },
            {
              id: fixtureIds.olderReview,
              teacher_id: 1,
              teacher_name: 'Ирина Мастер',
              rating: 4,
              comment: 'Хорошо',
              status: 'approved',
              created_at: '2026-02-01 13:00:00',
            },
          ],
          latest_review: {
            id: fixtureIds.latestReview,
            teacher_id: 1,
            teacher_name: 'Ирина Мастер',
            rating: 5,
            comment: 'Отлично',
            status: 'approved',
            created_at: '2026-02-01 14:00:00',
          },
          comments: [
            {
              id: fixtureIds.studentComment,
              author_user_id: 1,
              author_name: 'Алиса Ученица',
              author_role: 'student',
              text_content: 'Спасибо',
              created_at: '2026-02-01 15:00:00',
            },
            {
              id: fixtureIds.teacherComment,
              author_user_id: 3,
              author_name: 'Ирина Мастер',
              author_role: 'teacher',
              text_content: 'Продолжайте',
              created_at: '2026-02-01 16:00:00',
            },
          ],
          extra_files_count: 2,
          attachments: [
            {
              id: fixtureIds.localAttachment,
              content_type: 'photo',
              has_file: true,
            },
            {
              id: fixtureIds.remoteAttachment,
              content_type: 'photo',
              has_file: true,
            },
          ],
        },
      ],
      average_rating: 4.5,
      ratings_count: 2,
    },
  })
})

test('student/homeworks изолирует данные и поддерживает web-session/nginx-путь', async () => {
  const bob = await app.inject({
    method: 'GET',
    url: `/api/student/homeworks?max_user_id=${bobMaxUserId}`,
    headers: authHeaders(bobMaxUserId),
  })
  assert.equal(bob.statusCode, 200)
  assert.deepEqual(bob.json().data.homeworks.map((homework: { id: number }) => homework.id), [fixtureIds.bobHomework])

  const web = await app.inject({
    method: 'GET',
    url: `/student/homeworks?max_user_id=${aliceMaxUserId}`,
    headers: { 'x-web-session': webSessionToken },
  })
  assert.equal(web.statusCode, 200)
  assert.equal(web.json().data.homeworks.length, 2)
})

test('student/homeworks сохраняет auth и not-found ошибки', async (context) => {
  await context.test('нет credential', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/student/homeworks?max_user_id=${aliceMaxUserId}`,
    })
    assert.equal(response.statusCode, 401)
  })

  await context.test('credential не совпадает', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/student/homeworks?max_user_id=${aliceMaxUserId}`,
      headers: authHeaders(bobMaxUserId),
    })
    assert.equal(response.statusCode, 403)
  })

  await context.test('пользователь не ученик', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/student/homeworks?max_user_id=${teacherMaxUserId}`,
      headers: authHeaders(teacherMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Ученик не найден.' })
  })

  await context.test('подписанный неизвестный пользователь', async () => {
    const unknownMaxUserId = 8999
    const response = await app.inject({
      method: 'GET',
      url: `/api/student/homeworks?max_user_id=${unknownMaxUserId}`,
      headers: authHeaders(unknownMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Ученик не найден.' })
  })
})
