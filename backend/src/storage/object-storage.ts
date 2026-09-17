import type { Readable } from 'node:stream'

export type StoredObject = {
  stream: Readable
  contentType: string | null
}

/** Источник для записи: готовый файл на диске (после staging/sharp) либо буфер. */
export type ObjectSource = { path: string } | { buffer: Buffer }

/** Ключ объекта: относительный путь без `..`, например `homeworks/1727-uuid.jpg`. */
export const isSafeObjectKey = (key: string | null | undefined): key is string =>
  Boolean(
    key &&
      key.length <= 512 &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) &&
      key.split('/').every((segment) => segment && segment !== '.' && segment !== '..'),
  )

/** Хранилище файлов приложения: S3 в production, каталог на диске для разработки и тестов. */
export abstract class ObjectStorage {
  abstract put(key: string, source: ObjectSource, contentType: string): Promise<void>
  abstract exists(key: string): Promise<boolean>
  abstract open(key: string): Promise<StoredObject | null>
  abstract delete(key: string): Promise<void>
}
