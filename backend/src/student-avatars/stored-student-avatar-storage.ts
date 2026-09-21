import type { Readable } from 'node:stream'
import { Inject, Injectable } from '@nestjs/common'
import sharp from 'sharp'
import { isSafeObjectKey, ObjectStorage } from '../storage/object-storage.js'
import { newObjectKey, removeStaged, stageStream } from '../storage/staging.js'
import { AvatarImageProcessingError, StudentAvatarStorage } from './student-avatar-storage.js'

@Injectable()
export class StoredStudentAvatarStorage implements StudentAvatarStorage {
  constructor(@Inject(ObjectStorage) private readonly storage: ObjectStorage) {}

  async saveAvatar(source: Readable, studentId: number): Promise<string> {
    const sourcePath = await stageStream(source, 'avatar-upload')
    let avatar: Buffer
    try {
      avatar = await sharp(sourcePath)
        .rotate()
        .resize(400, 400, { fit: 'cover' })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer()
    } catch (error) {
      throw new AvatarImageProcessingError('Не удалось обработать изображение.', { cause: error })
    } finally {
      await removeStaged(sourcePath)
    }
    const key = newObjectKey(`avatars/${studentId}`, '.jpg')
    await this.storage.put(key, { buffer: avatar }, 'image/jpeg')
    return key
  }

  async deleteAvatar(fileId: string | null): Promise<void> {
    if (isSafeObjectKey(fileId)) await this.storage.delete(fileId)
  }
}
