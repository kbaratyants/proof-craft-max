import sharp, { type JpegOptions } from 'sharp'
import { ObjectStorage } from './object-storage.js'
import { newObjectKey, newStagingPath, removeStaged, safeExtension } from './staging.js'

export type StagedUpload = { path: string; filename: string; mimeType: string }
export type StoredUpload = { path: string; mimeType: string }

const isImage = (file: StagedUpload): boolean =>
  file.mimeType.toLowerCase().startsWith('image/') ||
  ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'].includes(safeExtension(file.filename))

const isHeic = (file: StagedUpload): boolean =>
  ['image/heic', 'image/heif'].includes(file.mimeType.toLowerCase()) ||
  ['.heic', '.heif'].includes(safeExtension(file.filename))

/**
 * Переносит загруженный файл в хранилище: изображения перекодируются в JPEG,
 * остальные файлы сохраняются как есть. HEIC, который sharp не прочитал, — ошибка `onUnsupportedImage`.
 * В `path` результата — ключ объекта, он и записывается в БД.
 */
export const storeUpload = async (
  storage: ObjectStorage,
  staged: StagedUpload,
  folder: string,
  jpeg: JpegOptions,
  onUnsupportedImage: (cause: unknown) => Error,
): Promise<StoredUpload> => {
  try {
    if (isImage(staged)) {
      const imagePath = newStagingPath('.jpg')
      try {
        await sharp(staged.path).rotate().jpeg(jpeg).toFile(imagePath)
        const key = newObjectKey(folder, '.jpg')
        await storage.put(key, { path: imagePath }, 'image/jpeg')
        return { path: key, mimeType: 'image/jpeg' }
      } catch (error) {
        if (isHeic(staged)) throw onUnsupportedImage(error)
      } finally {
        await removeStaged(imagePath)
      }
    }
    const key = newObjectKey(folder, safeExtension(staged.filename))
    await storage.put(key, { path: staged.path }, staged.mimeType || 'application/octet-stream')
    return { path: key, mimeType: staged.mimeType }
  } finally {
    await removeStaged(staged.path)
  }
}

/** Путь из staging удаляется с диска, ключ — из хранилища. */
export const discardUpload = async (storage: ObjectStorage, path: string | null): Promise<void> => {
  if (!path) return
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) await removeStaged(path)
  else await storage.delete(path)
}
