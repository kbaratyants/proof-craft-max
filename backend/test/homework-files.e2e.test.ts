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

const botToken = '123456:nest-homework-file-token'
const webSessionToken = 'nest-homework-file-web-session'
const ownerMaxUserId = 9101
const outsiderMaxUserId = 9102
const teacherMaxUserId = 9201
const adminMaxUserId = 9301
const testImageSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'

type FixtureIds = {
  ownerHomework: number
  missingFileHomework: number
  outsiderHomework: number
  ownerAttachment: number
  outsiderAttachment: number
}

let temporaryRoot: string
let app: NestFastifyApplication
let fixtureIds: FixtureIds

const seedHomeworkFiles = (databasePath: string): FixtureIds => {
  const db = new Database(databasePath)
  const uploadsDirectory = join(dirname(databasePath), 'uploads')
  mkdirSync(uploadsDirectory, { recursive: true })
  const ownerFile = 'owner-homework.svg'
  const outsiderFile = 'outsider-homework.txt'
  writeFileSync(join(uploadsDirectory, ownerFile), testImageSvg)
  writeFileSync(join(uploadsDirectory, outsiderFile), 'outsider homework')

  const insertUser = db.prepare(`
    INSERT INTO users (max_user_id, first_name, role)
    VALUES (?, ?, ?)
  `)
  const ownerUser = Number(insertUser.run(ownerMaxUserId, 'Owner', 'student').lastInsertRowid)
  const outsiderUser = Number(insertUser.run(outsiderMaxUserId, 'Outsider', 'student').lastInsertRowid)
  const teacherUser = Number(insertUser.run(teacherMaxUserId, 'Teacher', 'teacher').lastInsertRowid)
  const adminUser = Number(insertUser.run(adminMaxUserId, 'Admin', 'admin').lastInsertRowid)
  const insertRole = db.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?, ?)`)
  insertRole.run(ownerUser, 'student')
  insertRole.run(outsiderUser, 'student')
  insertRole.run(teacherUser, 'teacher')
  insertRole.run(adminUser, 'admin')

  const insertStudent = db.prepare(`
    INSERT INTO students (user_id, full_name, phone, lessons_count, status)
    VALUES (?, ?, '+70000000000', 1, 'studying')
  `)
  const ownerStudent = Number(insertStudent.run(ownerUser, 'Owner Student').lastInsertRowid)
  const outsiderStudent = Number(insertStudent.run(outsiderUser, 'Outsider Student').lastInsertRowid)
  const teacher = Number(
    db.prepare(`INSERT INTO teachers (user_id, full_name) VALUES (?, 'Assigned Teacher')`)
      .run(teacherUser).lastInsertRowid,
  )
  db.prepare(`INSERT INTO student_teachers (student_id, teacher_id) VALUES (?, ?)`)
    .run(ownerStudent, teacher)

  const insertHomework = db.prepare(`
    INSERT INTO homeworks (student_id, lesson_number, content_type, file_id, status)
    VALUES (?, ?, ?, ?, 'pending')
  `)
  const ownerHomework = Number(
    insertHomework.run(ownerStudent, 1, 'photo', ownerFile).lastInsertRowid,
  )
  db.prepare(`UPDATE homeworks SET revision_student_file_id = ? WHERE id = ?`)
    .run(ownerFile, ownerHomework)
  const missingFileHomework = Number(
    insertHomework.run(ownerStudent, 2, 'text', null).lastInsertRowid,
  )
  const outsiderHomework = Number(
    insertHomework.run(outsiderStudent, 1, 'document', outsiderFile).lastInsertRowid,
  )
  const insertAttachment = db.prepare(`
    INSERT INTO homework_files (homework_id, file_id, content_type, sort_order)
    VALUES (?, ?, ?, 0)
  `)
  const ownerAttachment = Number(
    insertAttachment.run(ownerHomework, ownerFile, 'photo').lastInsertRowid,
  )
  const outsiderAttachment = Number(
    insertAttachment.run(outsiderHomework, outsiderFile, 'document').lastInsertRowid,
  )

  db.prepare(`
    INSERT INTO web_sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+1 day'))
  `).run(ownerUser, crypto.createHash('sha256').update(webSessionToken).digest('hex'))
  db.close()
  return {
    ownerHomework,
    missingFileHomework,
    outsiderHomework,
    ownerAttachment,
    outsiderAttachment,
  }
}

const buildMaxInitData = (maxUserId: number): string => {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: `homework-file-${maxUserId}`,
    user: JSON.stringify({ id: maxUserId, first_name: 'File' }),
  })
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  params.set('hash', crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex'))
  return params.toString()
}

const authHeaders = (maxUserId: number): Record<string, string> => ({
  'x-max-init-data': buildMaxInitData(maxUserId),
})

before(async () => {
  const fixture = await createTestDatabase('proof-craft-homework-files-')
  temporaryRoot = fixture.temporaryRoot
  fixtureIds = seedHomeworkFiles(fixture.databasePath)
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

test('владелец, назначенный преподаватель и администратор читают основной файл', async () => {
  for (const maxUserId of [ownerMaxUserId, teacherMaxUserId, adminMaxUserId]) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/file?max_user_id=${maxUserId}`,
      headers: authHeaders(maxUserId),
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'image/jpeg')
    assert.equal(response.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.equal(response.body, testImageSvg)
  }
})

test('авторизованный файл поддерживает preview, web-session и nginx-путь', async () => {
  const preview = await app.inject({
    method: 'GET',
    url: `/api/homeworks/${fixtureIds.ownerHomework}/file?max_user_id=${ownerMaxUserId}&preview=true`,
    headers: authHeaders(ownerMaxUserId),
  })
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.headers['content-type'], 'image/jpeg')
  assert.deepEqual([...preview.rawPayload.subarray(0, 2)], [0xff, 0xd8])

  const web = await app.inject({
    method: 'GET',
    url: `/homeworks/${fixtureIds.ownerHomework}/file?max_user_id=${ownerMaxUserId}`,
    headers: { 'x-web-session': webSessionToken },
  })
  assert.equal(web.statusCode, 200)
  assert.equal(web.body, testImageSvg)
})

test('посторонний ученик и неназначенный преподаватель не читают файл', async () => {
  const outsider = await app.inject({
    method: 'GET',
    url: `/api/homeworks/${fixtureIds.ownerHomework}/file?max_user_id=${outsiderMaxUserId}`,
    headers: authHeaders(outsiderMaxUserId),
  })
  assert.equal(outsider.statusCode, 403)
  assert.deepEqual(outsider.json(), { ok: false, error: 'Нет доступа к этому файлу.' })

  const teacher = await app.inject({
    method: 'GET',
    url: `/api/homeworks/${fixtureIds.outsiderHomework}/file?max_user_id=${teacherMaxUserId}`,
    headers: authHeaders(teacherMaxUserId),
  })
  assert.equal(teacher.statusCode, 403)
  assert.deepEqual(teacher.json(), { ok: false, error: 'Нет доступа к этому файлу.' })
})

test('авторизованный файл сохраняет validation, auth и not-found ошибки', async (context) => {
  await context.test('некорректный id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/nope/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { ok: false, error: 'Некорректные параметры запроса.' })
  })

  await context.test('некорректный preview', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/file?max_user_id=${ownerMaxUserId}&preview=0`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { ok: false, error: 'Некорректные параметры запроса.' })
  })

  await context.test('нет credential', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/file?max_user_id=${ownerMaxUserId}`,
    })
    assert.equal(response.statusCode, 401)
  })

  await context.test('credential не совпадает', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(outsiderMaxUserId),
    })
    assert.equal(response.statusCode, 403)
  })

  await context.test('задание не существует', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/999999/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Задание не найдено.' })
  })

  await context.test('у задания нет файла', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.missingFileHomework}/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), {
      ok: false,
      error: 'Вложение недоступно для скачивания.',
    })
  })

  await context.test('подписанный неизвестный пользователь не получает существующий файл', async () => {
    const unknownMaxUserId = 9999
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/file?max_user_id=${unknownMaxUserId}`,
      headers: authHeaders(unknownMaxUserId),
    })
    assert.equal(response.statusCode, 403)
    assert.deepEqual(response.json(), { ok: false, error: 'Нет доступа к этому файлу.' })
  })
})

test('владелец, назначенный преподаватель и администратор читают файл исправления', async () => {
  for (const maxUserId of [ownerMaxUserId, teacherMaxUserId, adminMaxUserId]) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${maxUserId}`,
      headers: authHeaders(maxUserId),
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'image/jpeg')
    assert.equal(response.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.equal(response.body, testImageSvg)
  }
})

test('файл исправления поддерживает preview, web-session и nginx-путь', async () => {
  const preview = await app.inject({
    method: 'GET',
    url: `/api/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${ownerMaxUserId}&preview=1`,
    headers: authHeaders(ownerMaxUserId),
  })
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.headers['content-type'], 'image/jpeg')
  assert.deepEqual([...preview.rawPayload.subarray(0, 2)], [0xff, 0xd8])

  const web = await app.inject({
    method: 'GET',
    url: `/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${ownerMaxUserId}`,
    headers: { 'x-web-session': webSessionToken },
  })
  assert.equal(web.statusCode, 200)
  assert.equal(web.body, testImageSvg)
})

test('посторонний ученик не читает файл исправления', async () => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${outsiderMaxUserId}`,
    headers: authHeaders(outsiderMaxUserId),
  })
  assert.equal(response.statusCode, 403)
  assert.deepEqual(response.json(), { ok: false, error: 'Нет доступа к этому файлу.' })
})

test('файл исправления сохраняет validation, auth и not-found ошибки', async (context) => {
  await context.test('некорректный id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/nope/revision/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { ok: false, error: 'Некорректные параметры запроса.' })
  })

  await context.test('некорректный preview', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${ownerMaxUserId}&preview=0`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { ok: false, error: 'Некорректные параметры запроса.' })
  })

  await context.test('нет credential', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${ownerMaxUserId}`,
    })
    assert.equal(response.statusCode, 401)
  })

  await context.test('credential не совпадает', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(outsiderMaxUserId),
    })
    assert.equal(response.statusCode, 403)
  })

  await context.test('файл исправления отсутствует до проверки доступа', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.missingFileHomework}/revision/file?max_user_id=${outsiderMaxUserId}`,
      headers: authHeaders(outsiderMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Файл исправления не найден.' })
  })

  await context.test('подписанный неизвестный пользователь не получает файл', async () => {
    const unknownMaxUserId = 9999
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${unknownMaxUserId}`,
      headers: authHeaders(unknownMaxUserId),
    })
    assert.equal(response.statusCode, 403)
    assert.deepEqual(response.json(), { ok: false, error: 'Нет доступа к этому файлу.' })
  })
})

test('владелец, назначенный преподаватель и администратор читают вложение работы', async () => {
  for (const maxUserId of [ownerMaxUserId, teacherMaxUserId, adminMaxUserId]) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${maxUserId}`,
      headers: authHeaders(maxUserId),
    })
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'image/jpeg')
    assert.equal(response.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.equal(response.body, testImageSvg)
  }
})

test('вложение работы поддерживает preview, web-session и nginx-путь', async () => {
  const preview = await app.inject({
    method: 'GET',
    url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${ownerMaxUserId}&preview=1`,
    headers: authHeaders(ownerMaxUserId),
  })
  assert.equal(preview.statusCode, 200)
  assert.equal(preview.headers['content-type'], 'image/jpeg')
  assert.deepEqual([...preview.rawPayload.subarray(0, 2)], [0xff, 0xd8])

  const web = await app.inject({
    method: 'GET',
    url: `/homeworks/${fixtureIds.ownerHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${ownerMaxUserId}`,
    headers: { 'x-web-session': webSessionToken },
  })
  assert.equal(web.statusCode, 200)
  assert.equal(web.body, testImageSvg)
})

test('посторонний ученик и неназначенный преподаватель не читают вложение', async () => {
  const outsider = await app.inject({
    method: 'GET',
    url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${outsiderMaxUserId}`,
    headers: authHeaders(outsiderMaxUserId),
  })
  assert.equal(outsider.statusCode, 403)
  assert.deepEqual(outsider.json(), { ok: false, error: 'Нет доступа к этому файлу.' })

  const teacher = await app.inject({
    method: 'GET',
    url: `/api/homeworks/${fixtureIds.outsiderHomework}/attachments/${fixtureIds.outsiderAttachment}/file?max_user_id=${teacherMaxUserId}`,
    headers: authHeaders(teacherMaxUserId),
  })
  assert.equal(teacher.statusCode, 403)
  assert.deepEqual(teacher.json(), { ok: false, error: 'Нет доступа к этому файлу.' })
})

test('вложение работы сохраняет validation, auth и not-found ошибки', async (context) => {
  await context.test('некорректный homework id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/nope/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { ok: false, error: 'Некорректные параметры запроса.' })
  })

  await context.test('некорректный attachment id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/nope/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { ok: false, error: 'Некорректные параметры запроса.' })
  })

  await context.test('вложение не принадлежит работе из URL', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.missingFileHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Вложение не найдено.' })
  })

  await context.test('вложение не существует', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/999999/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 404)
    assert.deepEqual(response.json(), { ok: false, error: 'Вложение не найдено.' })
  })

  await context.test('некорректный preview', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${ownerMaxUserId}&preview=0`,
      headers: authHeaders(ownerMaxUserId),
    })
    assert.equal(response.statusCode, 400)
    assert.deepEqual(response.json(), { ok: false, error: 'Некорректные параметры запроса.' })
  })

  await context.test('нет credential', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${ownerMaxUserId}`,
    })
    assert.equal(response.statusCode, 401)
  })

  await context.test('credential не совпадает', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${ownerMaxUserId}`,
      headers: authHeaders(outsiderMaxUserId),
    })
    assert.equal(response.statusCode, 403)
  })

  await context.test('подписанный неизвестный пользователь не получает вложение', async () => {
    const unknownMaxUserId = 9999
    const response = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/attachments/${fixtureIds.ownerAttachment}/file?max_user_id=${unknownMaxUserId}`,
      headers: authHeaders(unknownMaxUserId),
    })
    assert.equal(response.statusCode, 403)
    assert.deepEqual(response.json(), { ok: false, error: 'Нет доступа к этому файлу.' })
  })
})

const requestDownloadLink = async (maxUserId: number, path: string) =>
  await app.inject({
    method: 'POST',
    url: '/api/downloads/link',
    headers: authHeaders(maxUserId),
    payload: { max_user_id: maxUserId, path },
  })

test('ссылка на скачивание открывает файл без заголовков MAX', async () => {
  const path = `/api/homeworks/${fixtureIds.ownerHomework}/file`
  const link = await requestDownloadLink(ownerMaxUserId, `${path}?max_user_id=${ownerMaxUserId}`)
  assert.equal(link.statusCode, 200)
  const { url } = link.json() as { url: string }
  assert.match(url, new RegExp(`^${path}\\?max_user_id=${ownerMaxUserId}&dl=`))

  const download = await app.inject({ method: 'GET', url })
  assert.equal(download.statusCode, 200)
  assert.equal(download.body, testImageSvg)
})

test('ссылка на скачивание не расширяет права и не переносится', async (context) => {
  await context.test('чужой файл по своей ссылке — 403 от контроллера файла', async () => {
    const link = await requestDownloadLink(outsiderMaxUserId, `/api/homeworks/${fixtureIds.ownerHomework}/file`)
    const download = await app.inject({ method: 'GET', url: (link.json() as { url: string }).url })
    assert.equal(download.statusCode, 403)
  })

  const link = await requestDownloadLink(ownerMaxUserId, `/api/homeworks/${fixtureIds.ownerHomework}/file`)
  const url = (link.json() as { url: string }).url
  const token = new URL(url, 'http://local').searchParams.get('dl') ?? ''

  await context.test('токен не подходит к другому файлу', async () => {
    const other = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.ownerHomework}/revision/file?max_user_id=${ownerMaxUserId}&dl=${token}`,
    })
    assert.equal(other.statusCode, 401)
  })

  await context.test('токен не подходит другому пользователю', async () => {
    const other = await app.inject({
      method: 'GET',
      url: `/api/homeworks/${fixtureIds.outsiderHomework}/file?max_user_id=${outsiderMaxUserId}&dl=${token}`,
    })
    assert.equal(other.statusCode, 401)
  })

  await context.test('токен не открывает запись', async () => {
    const write = await app.inject({
      method: 'POST',
      url: `/api/downloads/link?max_user_id=${ownerMaxUserId}&dl=${token}`,
      payload: { max_user_id: ownerMaxUserId, path: `/api/homeworks/${fixtureIds.ownerHomework}/file` },
    })
    assert.equal(write.statusCode, 401)
  })

  await context.test('испорченный токен', async () => {
    const broken = await app.inject({ method: 'GET', url: `${url}x` })
    assert.equal(broken.statusCode, 401)
  })
})

test('ссылку на скачивание выдают только для файлов и только с авторизацией', async () => {
  const notFile = await requestDownloadLink(ownerMaxUserId, '/api/session')
  assert.equal(notFile.statusCode, 400)
  const traversal = await requestDownloadLink(ownerMaxUserId, '/api/homeworks/../session/file')
  assert.equal(traversal.statusCode, 400)
  const anonymous = await app.inject({
    method: 'POST',
    url: '/api/downloads/link',
    payload: { max_user_id: ownerMaxUserId, path: `/api/homeworks/${fixtureIds.ownerHomework}/file` },
  })
  assert.equal(anonymous.statusCode, 401)
})
