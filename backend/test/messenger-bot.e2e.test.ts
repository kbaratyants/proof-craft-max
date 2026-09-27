import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test, { after, before } from 'node:test'
import Database from 'better-sqlite3'
import type { INestApplicationContext } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FeedbackInvitesWorker } from '../src/messenger/feedback-invites.worker.js'
import { MessengerModule } from '../src/messenger/messenger.module.js'
import { MaxAdapter } from '../src/messenger/max/max.adapter.js'
import { buttonsOf, chatOf, FakeMax } from './support/fake-max.js'
import { createTestDatabase } from './support/test-database.js'

const botToken = '123456:nest-bot-token'
const people = {
  admin: { id: 9601, first_name: 'Admin', username: 'boss' },
  teacher: { id: 9602, first_name: 'Ирина', last_name: 'Соколова', username: 'irina' },
  otherTeacher: { id: 9603, first_name: 'Дмитрий', username: 'dima' },
  student: { id: 9604, first_name: 'Анна', username: 'anna' },
  applicant: { id: 9605, first_name: 'Ольга' },
  newcomer: { id: 9606, first_name: 'Никита', last_name: 'Новиков', username: 'nikita' },
  stranger: { id: 9607, first_name: 'Гость' },
}

let temporaryRoot: string
let databasePath: string
let context: INestApplicationContext
const max = new FakeMax(botToken)
const ids = { teacherId: 0, otherTeacherId: 0, studentId: 0, applicantId: 0, photoHomeworkId: 0, textHomeworkId: 0 }

const withDb = <T>(fn: (db: Database.Database) => T): T => {
  const db = new Database(databasePath)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}
const mark = () => max.calls.length

before(async () => {
  const fixture = await createTestDatabase('proof-craft-bot-')
  temporaryRoot = fixture.temporaryRoot
  databasePath = fixture.databasePath
  const uploads = join(dirname(databasePath), 'uploads')
  mkdirSync(uploads, { recursive: true })
  const photoPath = 'bot-photo.jpg'
  writeFileSync(join(uploads, photoPath), 'jpeg-bytes')
  withDb((db) => {
    const insertUser = db.prepare('INSERT INTO users (max_user_id, username, first_name, last_name, role) VALUES (?, ?, ?, ?, ?)')
    const addRole = db.prepare('INSERT INTO user_roles (user_id, role) VALUES (?, ?)')
    const user = (p: { id: number; username?: string; first_name: string; last_name?: string }, role: string) => {
      const id = Number(insertUser.run(p.id, p.username ?? null, p.first_name, p.last_name ?? null, role).lastInsertRowid)
      addRole.run(id, role)
      return id
    }
    const admin = user(people.admin, 'admin')
    void admin
    const teacher = user(people.teacher, 'teacher')
    const otherTeacher = user(people.otherTeacher, 'teacher')
    const student = user(people.student, 'student')
    const applicant = user(people.applicant, 'student')
    user(people.newcomer, 'guest')
    const insertTeacher = db.prepare('INSERT INTO teachers (user_id, full_name) VALUES (?, ?)')
    ids.teacherId = Number(insertTeacher.run(teacher, 'Ирина Соколова').lastInsertRowid)
    ids.otherTeacherId = Number(insertTeacher.run(otherTeacher, 'Дмитрий Орлов').lastInsertRowid)
    const insertStudent = db.prepare(`INSERT INTO students (user_id, full_name, phone, lessons_count, status) VALUES (?, ?, ?, 10, ?)`)
    ids.studentId = Number(insertStudent.run(student, 'Анна Смирнова', '+79990000001', 'studying').lastInsertRowid)
    ids.applicantId = Number(insertStudent.run(applicant, 'Ольга Петрова', '+79990000004', 'moderation').lastInsertRowid)
    db.prepare('INSERT INTO student_teachers (student_id, teacher_id) VALUES (?, ?)').run(ids.studentId, ids.teacherId)
    const insertHomework = db.prepare(`INSERT INTO homeworks (student_id, lesson_number, is_bonus, content_type, file_id, text_content, status) VALUES (?, ?, 0, ?, ?, ?, 'pending')`)
    ids.photoHomeworkId = Number(insertHomework.run(ids.studentId, 4, 'photo', photoPath, 'Оформление бороды.').lastInsertRowid)
    ids.textHomeworkId = Number(insertHomework.run(ids.studentId, 5, 'text', null, 'Разбор техники.').lastInsertRowid)
  })

  process.env.DATABASE_URL = `file:${databasePath}`
  process.env.MAX_BOT_TOKEN = botToken
  process.env.MAX_API_BASE_URL = await max.start()
  process.env.MAX_POLL_TIMEOUT_SEC = '0'
  context = await NestFactory.createApplicationContext(MessengerModule, { logger: false })
  context.enableShutdownHooks()
  context.get(MaxAdapter).start(botToken)
})

after(async () => {
  await context?.close()
  await max.stop()
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test('/start приветствует и создаёт guest-пользователя', async () => {
  const since = mark()
  await max.started(people.stranger, null)
  assert.deepEqual(max.texts(since), ['Привет! Чтобы войти в приложение, нажми на кнопку «Дневник» в левом нижнем углу.'])
  const user = withDb((db) => db.prepare(`SELECT u.role, (SELECT group_concat(role) FROM user_roles WHERE user_id = u.id) AS roles FROM users u WHERE max_user_id = ?`).get(people.stranger.id))
  assert.deepEqual(user, { role: 'guest', roles: 'guest' })
})

test('с DEMO_MODE приветствие содержит кнопку «Демо для жюри»', async () => {
  const saved = { demo: process.env.DEMO_MODE, bot: process.env.MAX_BOT_USERNAME, site: process.env.WEB_APP_URL }
  try {
    process.env.DEMO_MODE = 'true'
    process.env.MAX_BOT_USERNAME = '@academy_bot'
    let since = mark()
    await max.started(people.stranger, null)
    assert.deepEqual(buttonsOf(max.sent(since)[0]), [{ type: 'open_app', text: 'Демо для жюри', web_app: 'academy_bot', payload: 'demo' }])
    delete process.env.MAX_BOT_USERNAME
    process.env.WEB_APP_URL = 'https://academy.example/app'
    since = mark()
    await max.started(people.stranger, null)
    assert.deepEqual(buttonsOf(max.sent(since)[0]), [{ type: 'link', text: 'Демо для жюри', url: 'https://academy.example/app?demo=1' }])
  } finally {
    for (const [key, value] of [['DEMO_MODE', saved.demo], ['MAX_BOT_USERNAME', saved.bot], ['WEB_APP_URL', saved.site]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('запуск по ссылке ?start=webauth_<token> подтверждает вход на сайт один раз', async () => {
  const token = crypto.randomBytes(32).toString('base64url')
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  withDb((db) => db.prepare(`INSERT INTO web_login_requests (provider, token_hash, expires_at) VALUES ('max', ?, datetime('now', '+15 minutes'))`).run(hash))
  let since = mark()
  await max.started(people.student, `webauth_${token}`)
  assert.deepEqual(max.texts(since), ['Вход подтверждён. Вернитесь в браузер — дневник откроется автоматически.'])
  const approvedBy = withDb((db) => db.prepare(`SELECT u.max_user_id FROM web_login_requests r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?`).get(hash))
  assert.deepEqual(approvedBy, { max_user_id: people.student.id })
  since = mark()
  await max.message(people.student, `/start webauth_${token}`)
  assert.deepEqual(max.texts(since), ['Ссылка для входа истекла или уже была использована. Вернитесь на сайт и начните вход заново.'])
})

test('/admin доступна только администратору', async () => {
  let since = mark()
  await max.message(people.student, '/admin')
  assert.deepEqual(max.texts(since), ['У вас нет доступа к админ-панели.'])
  since = mark()
  await max.message(people.admin, '/admin')
  const [menu] = max.after(since)
  assert.equal(menu?.body.text, '🔐 Админ-панель')
  assert.deepEqual(buttonsOf(menu!).map((b) => b.payload), ['admin_moderation', 'admin_active', 'admin_teachers'])
})

test('модерация: заявка одобряется через общий use case с аудитом и уведомлением ученику', async () => {
  let since = mark()
  await max.press(people.admin, 'admin_moderation')
  const card = max.after(since).find((c) => c.method === 'messages')!
  assert.equal(card.body.text, 'Новый ученик: Ольга Петрова\nТелефон: +79990000004\nКоличество занятий: 10')
  assert.deepEqual(buttonsOf(card).map((b) => b.payload), [`admin_approve_${ids.applicantId}`, `admin_reject_${ids.applicantId}`])
  since = mark()
  await max.press(people.stranger, `admin_approve_${ids.applicantId}`)
  assert.deepEqual(max.texts(since, people.stranger.id), ['Доступ только для администраторов.'])
  since = mark()
  await max.press(people.admin, `admin_approve_${ids.applicantId}`)
  assert.deepEqual(max.texts(since, people.admin.id), ['✅ Ученик Ольга Петрова одобрен и активирован.'])
  assert.deepEqual(max.texts(since, people.applicant.id), ['🎉 Ваша заявка одобрена! Теперь вы можете сдавать домашние задания.'])
  const state = withDb((db) => ({
    status: (db.prepare('SELECT status FROM students WHERE id = ?').get(ids.applicantId) as { status: string }).status,
    audit: (db.prepare('SELECT action FROM audit_log ORDER BY id DESC LIMIT 1').get() as { action: string }).action,
  }))
  assert.deepEqual(state, { status: 'studying', audit: 'admin_student_approve' })
})

test('роль преподавателя назначается и снимается по ID пользователя в MAX без удаления профиля (SEC-003)', async () => {
  let since = mark()
  await max.press(people.admin, 'admin_teachers_assign_id')
  await max.message(people.admin, 'не число')
  await max.message(people.admin, String(people.newcomer.id))
  assert.deepEqual(max.texts(since, people.admin.id), [
    'Отправьте ID пользователя в MAX пользователя, которого нужно назначить преподавателем.',
    'Не удалось распознать ID пользователя в MAX. Отправьте числовой ID.',
    `✅ Пользователь ${people.newcomer.id} назначен преподавателем.`,
  ])
  const teacherName = withDb((db) => db.prepare(`SELECT t.full_name FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.max_user_id = ?`).get(people.newcomer.id))
  assert.deepEqual(teacherName, { full_name: 'Никита Новиков' })

  since = mark()
  await max.press(people.admin, 'admin_teachers_remove_id')
  await max.message(people.admin, String(people.otherTeacher.id))
  assert.deepEqual(max.texts(since, people.admin.id), [
    'Отправьте ID пользователя в MAX преподавателя, которого нужно удалить.',
    `✅ Преподаватель ${people.otherTeacher.id} удалён.`,
  ])
  const removed = withDb((db) => db.prepare(`
    SELECT (SELECT COUNT(*) FROM user_roles r JOIN users u ON u.id = r.user_id WHERE u.max_user_id = ? AND r.role = 'teacher') AS roles,
           (SELECT COUNT(*) FROM teachers WHERE id = ?) AS profiles
  `).get(people.otherTeacher.id, ids.otherTeacherId))
  assert.deepEqual(removed, { roles: 0, profiles: 1 })

  since = mark()
  await max.press(people.admin, 'admin_teachers_assign_id')
  await max.message(people.admin, '424242')
  assert.deepEqual(max.texts(since, people.admin.id).at(-1), 'Пользователь не найден. Попросите его отправить /start боту.')
})

test('ученик назначается преподавателю через меню', async () => {
  let since = mark()
  await max.press(people.admin, 'admin_assign_teacher')
  const teachersMenu = max.after(since).find((c) => c.method === 'messages')!
  assert.equal(teachersMenu.body.text, 'Выберите преподавателя:')
  const newTeacherId = withDb((db) => (db.prepare(`SELECT t.id FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.max_user_id = ?`).get(people.newcomer.id) as { id: number }).id)
  assert.ok(buttonsOf(teachersMenu).some((b) => b.payload === `admin_assign_teacher_${newTeacherId}`))
  since = mark()
  await max.press(people.admin, `admin_assign_teacher_${newTeacherId}`)
  const studentsMenu = max.after(since).find((c) => c.method === 'messages')!
  assert.equal(studentsMenu.body.text, `Выберите ученика для преподавателя Никита Новиков (@nikita · id ${newTeacherId}):`)
  since = mark()
  await max.press(people.admin, `admin_assign_student_${newTeacherId}_${ids.studentId}`)
  assert.deepEqual(max.texts(since, people.admin.id), ['✅ Ученик назначен преподавателю.'])
  const answer = max.after(since).find((c) => c.method === 'answers')!
  assert.equal(answer.query.callback_id?.startsWith('cb-'), true)
  assert.equal(answer.body.notification, 'Ученик назначен преподавателю.')
  const assigned = withDb((db) => db.prepare('SELECT COUNT(*) AS count FROM student_teachers WHERE student_id = ? AND teacher_id = ?').get(ids.studentId, newTeacherId))
  assert.deepEqual(assigned, { count: 1 })
})

test('/teacher показывает работы на проверке с фото и принимает работу через диалог', async () => {
  let since = mark()
  await max.message(people.teacher, '/teacher')
  const [list] = max.after(since)
  assert.equal(list?.body.text, '📝 Проверить задания:\n\nАнна Смирнова (2 непроверенных)\n')
  assert.deepEqual(buttonsOf(list!).map((b) => b.payload), [`teacher_student_${ids.studentId}`])

  since = mark()
  await max.press(people.teacher, `teacher_student_${ids.studentId}`)
  const calls = max.after(since)
  assert.deepEqual(calls.find((c) => c.method === 'uploads')?.query, { type: 'image' })
  assert.deepEqual(calls.find((c) => c.method === 'upload/image')?.body, { data: { uploadedFile: 'bot-photo.jpg', size: 10 } })
  const [photo, text] = max.sent(since, people.teacher.id)
  assert.equal(photo?.query.chat_id, String(chatOf(people.teacher.id)))
  assert.equal(photo?.body.text, '📝 Урок №4\nТекст: Оформление бороды.\nФайл: photo\n')
  assert.deepEqual((photo?.body.attachments as unknown[])[0], { type: 'image', payload: { photos: { p1: { token: 'photo-token' } } } })
  assert.deepEqual(buttonsOf(photo).map((b) => b.payload), [`review_approve_${ids.photoHomeworkId}`, `review_comment_${ids.photoHomeworkId}`])
  assert.equal(text?.body.text, '📝 Урок №5\nТекст: Разбор техники.\n')

  since = mark()
  await max.press(people.teacher, `review_approve_${ids.photoHomeworkId}`)
  await max.message(people.teacher, '7')
  await max.message(people.teacher, '5')
  await max.message(people.teacher, 'Отличная работа')
  assert.deepEqual(max.texts(since, people.teacher.id), [
    '⭐ Введите оценку от 1 до 5:',
    'Оценка должна быть от 1 до 5. Попробуйте ещё раз.',
    '✏️ Введите комментарий (или отправьте "-" чтобы пропустить):',
    '✅ Проверка сохранена.',
  ])
  assert.deepEqual(max.texts(since, people.student.id), ['✅ Твое задание по урок №4 проверено.\nОценка: ⭐⭐⭐⭐⭐\nКомментарий: Отличная работа'])
  const review = withDb((db) => db.prepare('SELECT h.status, r.rating, r.comment FROM homeworks h JOIN homework_reviews r ON r.homework_id = h.id WHERE h.id = ?').get(ids.photoHomeworkId))
  assert.deepEqual(review, { status: 'approved', rating: 5, comment: 'Отличная работа' })

  since = mark()
  await max.press(people.teacher, `review_comment_${ids.photoHomeworkId}`)
  await max.message(people.teacher, 'Ещё раз')
  assert.equal(max.texts(since, people.teacher.id).at(-1), 'Это задание уже проверено.')
})

test('преподаватель без назначения не может проверить чужую работу', async () => {
  withDb((db) => db.prepare('DELETE FROM student_teachers WHERE teacher_id = (SELECT t.id FROM teachers t JOIN users u ON u.id = t.user_id WHERE u.max_user_id = ?)').run(people.newcomer.id))
  const since = mark()
  await max.press(people.newcomer, `review_comment_${ids.textHomeworkId}`)
  await max.message(people.newcomer, 'Переделать')
  assert.equal(max.texts(since, people.newcomer.id).at(-1), 'Ученик не прикреплён к этому преподавателю.')
  const status = withDb((db) => db.prepare('SELECT status FROM homeworks WHERE id = ?').get(ids.textHomeworkId))
  assert.deepEqual(status, { status: 'pending' })
})

test('приглашения к отзыву уходят один раз личным сообщением с кнопкой на форму', async () => {
  const worker = context.get(FeedbackInvitesWorker)
  assert.equal(worker.feedbackUrl('http://academy.local'), null)
  const url = worker.feedbackUrl('https://academy.example/app')!
  assert.equal(url, 'https://academy.example/app?feedback=1')
  withDb((db) => db.prepare(`INSERT INTO feedback_invites (student_id, milestone) VALUES (?, 5)`).run(ids.studentId))
  const since = mark()
  await worker.runOnce(context.get(MaxAdapter), url)
  const sent = max.sent(since)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.query.user_id, String(people.student.id))
  assert.equal(
    sent[0]?.body.text,
    'Урок №5 принят! Поделитесь впечатлениями о преподавателе и академии. Сообщение увидит только администратор вместе с вашим именем. Преподаватель не получит отзыв или уведомление о нём.',
  )
  assert.deepEqual(buttonsOf(sent[0]), [{ type: 'link', text: 'Оставить отзыв', url }])
  const statuses = withDb((db) => db.prepare('SELECT student_id, delivery_status FROM feedback_invites ORDER BY id').all())
  assert.deepEqual(statuses, [{ student_id: ids.studentId, delivery_status: 'sent' }])
  const again = mark()
  await worker.runOnce(context.get(MaxAdapter), url)
  assert.equal(max.after(again).length, 0)
})
