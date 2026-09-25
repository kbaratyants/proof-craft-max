# Proof Craft backend

NestJS API и бот «Дневника академии». 58 маршрутов API; бот живёт в `src/messenger/` и запускается отдельным процессом `dist/bot-main.js`.

## Команды

Из корня проекта:

```bash
npm run backend:dev
npm run bot:dev
npm test
```

После нового клонирования зависимости backend устанавливаются отдельно:

```bash
npm --prefix backend install
```

По умолчанию Nest слушает `127.0.0.1:8788`. Переопределение:

```bash
NEST_API_HOST=127.0.0.1 NEST_API_PORT=8788 npm --prefix backend start
```

## Prisma baseline

Схема находится в `backend/prisma/schema.prisma` и отражает 18 таблиц SQLite. Runtime требует абсолютный SQLite URL:

```bash
DATABASE_URL=file:/absolute/path/to/barber.db npm run backend:start
```

`/api/session` и остальные защищённые маршруты принимают два вида credentials: подписанный initData мини-приложения MAX в заголовке `X-Max-Init-Data` и web-session (`X-Web-Session`). Для строгого режима задаются `MAX_WEBAPP_AUTH=strict` и `MAX_BOT_TOKEN`: подпись initData проверяется HMAC-SHA256 с ключом, выведенным из токена бота.

Файлы хранит `src/storage/`: `ObjectStorage` с драйверами S3 (`@aws-sdk/client-s3`) и локального каталога. В БД записывается ключ объекта; ответы API сообщают `has_file`, а скачивание проверяет наличие объекта.

Публичный список отдаёт только профили `studying`. `works_count` и `GET /api/guest/students/:student_id/portfolio` учитывают только работы со статусом `approved`. Признак `has_file` означает, что у работы есть корректный ключ объекта в хранилище.

Публичный аватар отдаётся только для профиля `studying`. Файловый adapter принимает только безопасные ключи объектов, после чего controller потоково возвращает JPEG с публичным кэшированием на час.

Публичные `GET /api/guest/homeworks/:id/file` и `GET /api/guest/homeworks/:homeworkId/attachments/:attachmentId/file` отдают только `approved`-работы учеников `studying`. Вложение обязано принадлежать работе из URL. Storage adapter потоково отдаёт объект из хранилища и поддерживает JPEG-preview для фото.

`GET /api/showcase/homeworks` и его файловый маршрут требуют MAX- или web-session credential. Список содержит только `approved` фото/видео, чей объект есть в хранилище, убирает повторы и поддерживает `limit`, `exclude_ids` и `cycled`.

`GET /api/notifications` и `POST /api/notifications/read` требуют общий credential и не доверяют `max_user_id` как identity. Чтение и отметка одной/всех записей ограничены внутренним user ID. Лимит `1..80`, unread-счётчик, JSON payload, идемпотентная отметка и почасовая retention-очистка.

`GET /api/student/homeworks` возвращает только работы student-профиля, связанного с проверенным principal. Ответ сортирует работы (`pending` сверху), все проверки и комментарии, последнюю проверку, вложения, признаки `has_file` и рейтинг по `approved`-оценкам.

`GET /api/homeworks/:id/file` проверяет владельца, назначение преподавателя или роль администратора по проверенному principal. Общий storage adapter открывает объект из хранилища и создаёт JPEG-preview фото

`GET /api/homeworks/:homeworkId/revision/file` использует тот же access boundary, всегда трактует revision-файл как изображение и поддерживает preview. Отсутствующий `revision_student_file_id` возвращает `Файл исправления не найден.`.

`GET /api/homeworks/:homeworkId/attachments/:attachmentId/file` сначала подтверждает принадлежность вложения работе из URL, затем применяет ту же ролевую матрицу. Общий storage adapter отдаёт объект из хранилища и создаёт preview только для `photo`.

`GET /api/student/me/avatar` находит student-профиль только по внутреннему user ID проверенного principal и отдаёт JPEG из хранилища через общий storage adapter с `private, max-age=3600`. Отсутствующий профиль даёт ответ `Аватар не установлен.`.

`GET /api/students/:student_id/avatar` переиспользует файловую логику, но разрешает доступ только владельцу, назначенному преподавателю или администратору. Для совместимости access-check выполняется раньше проверки существования профиля.

`POST /api/student/me/avatar` потоково принимает multipart-файл с лимитом `MAX_HOMEWORK_UPLOAD_MB`, создаёт JPEG 400×400 и только затем обновляет student через Prisma. Новый файл очищается при ошибке БД или обработки; старый объект удаляется из хранилища после успешного обновления.

`POST /api/student/about` и `POST /api/teacher/about` принимают описание длиной до 1000 символов, обрезают внешние пробелы и сохраняют пустое значение как `NULL`. Нужный профиль определяется только по внутреннему user ID проверенного MAX- или web-session principal; controllers не обращаются к Prisma напрямую.

`POST /api/student/profile-edit` доступен student-профилям `studying` и `completed`. Транзакция отклоняет прежнюю pending-заявку и создаёт новую, не изменяя текущий профиль. После записи use case добавляет аудит, app-уведомления и best-effort сообщения администраторам в MAX через отдельный gateway; сбой вспомогательных уведомлений не отменяет заявку.

`GET /api/admin/profile-edits` требует роль `admin` и возвращает только pending-заявки по убыванию `created_at`: предложенные значения, текущие значения профиля и MAX ID ученика. Общая admin-проверка возвращает разные ответы для неизвестного пользователя и недостаточной роли.

Безопасные команды:

```bash
npm --prefix backend run prisma:validate
npm --prefix backend run prisma:generate
```

Миграций Prisma пока нет: структуру задаёт `prisma/schema.sql` , `schema.prisma` ей соответствует. Пустую базу создаёт `node dist/database/init-schema.js` (в Docker — при `INIT_SCHEMA=1`); существующую базу скрипт не меняет. `prisma db push` и `prisma migrate` не используются — изменение схемы вносится в оба файла.
