import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import os from 'node:os'
import { extname, isAbsolute, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Временный каталог для входящих файлов: там их проверяет и перекодирует sharp до записи в хранилище. */
export const stagingDirectory = (): string =>
  process.env.STORAGE_STAGING_DIR?.trim() || join(os.tmpdir(), 'proof-craft-staging')

export const stageStream = async (source: Readable, suffix: string): Promise<string> => {
  const directory = stagingDirectory()
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${randomUUID()}.${suffix}`)
  try {
    await pipeline(source, createWriteStream(path, { flags: 'wx' }))
    return path
  } catch (error) {
    await removeStaged(path)
    throw error
  }
}

export const newStagingPath = (extension: string): string => join(stagingDirectory(), `${randomUUID()}${extension}`)

export const removeStaged = async (path: string | null): Promise<void> => {
  if (!path || !isAbsolute(path)) return
  try {
    await unlink(path)
  } catch {
    // Очистка best-effort.
  }
}

export const safeExtension = (filename: string): string => {
  const extension = extname(filename).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''
}

/** Уникальный ключ объекта в «папке» хранилища. */
export const newObjectKey = (folder: string, extension: string): string =>
  `${folder}/${Date.now()}-${randomUUID()}${extension}`
