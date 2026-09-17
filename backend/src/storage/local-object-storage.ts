import { createReadStream } from 'node:fs'
import { copyFile, mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Injectable } from '@nestjs/common'
import { isSafeObjectKey, ObjectStorage, type ObjectSource, type StoredObject } from './object-storage.js'

/** Каталог объектов: STORAGE_LOCAL_DIR либо `uploads` рядом с файлом SQLite. */
export const localStorageRoot = (): string => {
  const configured = process.env.STORAGE_LOCAL_DIR?.trim()
  if (configured) return configured
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl?.startsWith('file:')) {
    throw new Error('Для локального хранилища задайте STORAGE_LOCAL_DIR или абсолютный SQLite DATABASE_URL.')
  }
  return join(dirname(fileURLToPath(new URL(databaseUrl))), 'uploads')
}

@Injectable()
export class LocalObjectStorage extends ObjectStorage {
  async put(key: string, source: ObjectSource, _contentType: string): Promise<void> {
    const target = this.resolve(key)
    await mkdir(dirname(target), { recursive: true })
    if ('path' in source) await copyFile(source.path, target)
    else await writeFile(target, source.buffer)
  }

  async exists(key: string): Promise<boolean> {
    if (!isSafeObjectKey(key)) return false
    try {
      return (await stat(this.resolve(key))).isFile()
    } catch {
      return false
    }
  }

  async open(key: string): Promise<StoredObject | null> {
    if (!isSafeObjectKey(key)) return null
    const path = this.resolve(key)
    try {
      if (!(await stat(path)).isFile()) return null
    } catch {
      return null
    }
    return { stream: createReadStream(path), contentType: null }
  }

  async delete(key: string): Promise<void> {
    if (!isSafeObjectKey(key)) return
    try {
      await unlink(this.resolve(key))
    } catch {
      // Удаление best-effort: результат определяет основная операция.
    }
  }

  private resolve(key: string): string {
    if (!isSafeObjectKey(key)) throw new Error(`Недопустимый ключ объекта: ${key}`)
    return join(localStorageRoot(), ...key.split('/'))
  }
}
