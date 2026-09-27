import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

/** prisma/schema.sql рядом с src/ и dist/: путь одинаков для tsx и собранного образа. */
const schemaPath = fileURLToPath(new URL('../../prisma/schema.sql', import.meta.url))

/**
 * Дополнения схемы для уже существующих баз: только новые таблицы через IF NOT EXISTS,
 * существующие данные и столбцы не трогаются.
 */
const ADDITIVE_SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, student_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
);
`

/**
 * Создаёт схему в пустой SQLite. В существующей базе только добавляет новые таблицы (ADDITIVE_SCHEMA);
 * изменения существующих таблиц не поддерживаются (см. docs/DECISIONS.md).
 */
export const initSchema = (databasePath: string): 'created' | 'exists' => {
  mkdirSync(dirname(databasePath), { recursive: true })
  const db = new Database(databasePath)
  try {
    db.pragma('journal_mode = WAL')
    const hasTables = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'`).get()
    if (hasTables) {
      db.exec(ADDITIVE_SCHEMA)
      return 'exists'
    }
    db.exec(`BEGIN; ${readFileSync(schemaPath, 'utf8')}; COMMIT;`)
    return 'created'
  } finally {
    db.close()
  }
}

const databaseUrl = process.env.DATABASE_URL?.trim()
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!databaseUrl?.startsWith('file:')) throw new Error('Для инициализации схемы требуется абсолютный SQLite DATABASE_URL.')
  const databasePath = fileURLToPath(new URL(databaseUrl))
  const result = initSchema(databasePath)
  console.log(result === 'created' ? `Схема создана: ${databasePath}` : `Схема уже есть: ${databasePath}`)
}
