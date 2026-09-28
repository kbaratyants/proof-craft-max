import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initSchema } from '../src/database/init-schema.js'
import { createTestDatabase } from './support/test-database.js'

test('initSchema создаёт схему в пустой базе, а в существующей только добавляет новые таблицы', async () => {
  const fixture = await createTestDatabase('proof-craft-schema-')
  try {
    const db = new Database(fixture.databasePath)
    const tables = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).get() as { n: number }
    assert.equal(tables.n, 20)
    db.prepare(`INSERT INTO users (max_user_id, first_name) VALUES (1, 'Проверка')`).run()
    // База, созданная до появления chat_reads и demo_viewers.
    db.exec('DROP TABLE chat_reads')
    db.exec('DROP TABLE demo_viewers')
    db.close()

    assert.equal(initSchema(fixture.databasePath), 'exists')
    const check = new Database(fixture.databasePath, { readonly: true })
    assert.equal((check.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n, 1)
    for (const table of ['chat_reads', 'demo_viewers']) {
      assert.ok(check.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table), table)
    }
    check.close()
  } finally {
    await rm(fixture.temporaryRoot, { recursive: true, force: true })
  }
})
