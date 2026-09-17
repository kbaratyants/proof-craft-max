import { Readable } from 'node:stream'
import { Inject, Injectable } from '@nestjs/common'
import sharp from 'sharp'
import { FileReferenceService, type OpenedFile, type OpenFileOptions } from './file-reference.service.js'
import { isSafeObjectKey, ObjectStorage } from './object-storage.js'

const readAll = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

@Injectable()
export class StoredFileReferenceService implements FileReferenceService {
  constructor(@Inject(ObjectStorage) private readonly storage: ObjectStorage) {}

  hasFile(fileId: string | null): boolean {
    return isSafeObjectKey(fileId)
  }

  async exists(fileId: string | null): Promise<boolean> {
    return isSafeObjectKey(fileId) && (await this.storage.exists(fileId))
  }

  async openFile(fileId: string | null, options: OpenFileOptions = {}): Promise<OpenedFile | null> {
    if (!isSafeObjectKey(fileId)) return null
    const stored = await this.storage.open(fileId)
    if (!stored) return null
    if (!options.imagePreview) return stored
    const original = await readAll(stored.stream)
    try {
      const preview = await sharp(original)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86, mozjpeg: true })
        .toBuffer()
      return { stream: Readable.from(preview), contentType: 'image/jpeg' }
    } catch {
      return { stream: Readable.from(original), contentType: stored.contentType }
    }
  }
}
