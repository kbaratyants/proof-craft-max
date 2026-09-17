import type { Readable } from 'node:stream'

export type OpenedFile = {
  stream: Readable
  contentType: string | null
}

export type OpenFileOptions = {
  imagePreview?: boolean
}

/** Доступ к файлам по ключу из БД (`file_id`, `avatar_file_id`). */
export abstract class FileReferenceService {
  /** Ссылка на файл корректна. Наличие объекта проверяется при открытии. */
  abstract hasFile(fileId: string | null): boolean
  /** Объект есть в хранилище (для S3 — HEAD-запрос). */
  abstract exists(fileId: string | null): Promise<boolean>
  abstract openFile(fileId: string | null, options?: OpenFileOptions): Promise<OpenedFile | null>
}
