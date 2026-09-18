import type { Readable } from 'node:stream'
import { Inject, Injectable } from '@nestjs/common'
import { ObjectStorage } from '../storage/object-storage.js'
import { stageStream } from '../storage/staging.js'
import { discardUpload, storeUpload } from '../storage/store-upload.js'
import {
  HomeworkSubmissionStorage,
  type FinalHomeworkFile,
  type StagedHomeworkFile,
  UnsupportedHomeworkImageError,
} from './homework-submission.storage.js'

@Injectable()
export class StoredHomeworkSubmissionStorage implements HomeworkSubmissionStorage {
  constructor(@Inject(ObjectStorage) private readonly storage: ObjectStorage) {}

  async stage(source: Readable, filename: string, mimeType: string): Promise<StagedHomeworkFile> {
    return { path: await stageStream(source, 'homework-upload'), filename, mimeType }
  }

  async finalize(staged: StagedHomeworkFile): Promise<FinalHomeworkFile> {
    return await storeUpload(
      this.storage,
      staged,
      'homeworks',
      { quality: 92, mozjpeg: true },
      (cause) => new UnsupportedHomeworkImageError('HEIC/HEIF не поддерживается.', { cause }),
    )
  }

  async discard(path: string | null): Promise<void> {
    await discardUpload(this.storage, path)
  }
}
