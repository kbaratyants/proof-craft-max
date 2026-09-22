import type { Readable } from 'node:stream'
import { Inject, Injectable } from '@nestjs/common'
import { ObjectStorage } from '../storage/object-storage.js'
import { stageStream } from '../storage/staging.js'
import { discardUpload, storeUpload } from '../storage/store-upload.js'
import {
  ChatAttachmentStorage,
  type FinalChatAttachment,
  type StagedChatAttachment,
  UnsupportedChatImageError,
} from './chat-attachment.storage.js'

@Injectable()
export class StoredChatAttachmentStorage implements ChatAttachmentStorage {
  constructor(@Inject(ObjectStorage) private readonly storage: ObjectStorage) {}

  async stage(source: Readable, filename: string, mimeType: string): Promise<StagedChatAttachment> {
    return { path: await stageStream(source, 'chat-upload'), filename, mimeType }
  }

  async finalize(staged: StagedChatAttachment): Promise<FinalChatAttachment> {
    return await storeUpload(
      this.storage,
      staged,
      'chat',
      { quality: 92 },
      (cause) => new UnsupportedChatImageError('HEIC/HEIF не поддерживается.', { cause }),
    )
  }

  async discard(path: string | null): Promise<void> {
    await discardUpload(this.storage, path)
  }
}
