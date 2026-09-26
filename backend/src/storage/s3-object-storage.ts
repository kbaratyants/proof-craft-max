import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Injectable } from '@nestjs/common'
import { isSafeObjectKey, ObjectStorage, type ObjectSource, type StoredObject } from './object-storage.js'

const required = (name: string): string => {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Для S3-хранилища не задана переменная ${name}.`)
  return value
}

/**
 * S3-совместимое хранилище (Yandex Object Storage, Selectel, MinIO…).
 * Файлы отдаются через API, а не публичными ссылками: права проверяет backend.
 */
@Injectable()
export class S3ObjectStorage extends ObjectStorage {
  private readonly bucket = required('S3_BUCKET')
  private readonly prefix = (process.env.S3_PREFIX || '').replace(/^\/+|\/+$/g, '')
  private readonly client = new S3Client({
    region: process.env.S3_REGION || 'ru-central1',
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: ['1', 'true'].includes(String(process.env.S3_FORCE_PATH_STYLE).toLowerCase()),
    // S3-совместимые хранилища не всегда принимают контрольные суммы CRC32, которые SDK шлёт по умолчанию.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
  })

  async put(key: string, source: ObjectSource, contentType: string): Promise<void> {
    const body =
      'path' in source
        ? { Body: createReadStream(source.path), ContentLength: (await stat(source.path)).size }
        : { Body: source.buffer, ContentLength: source.buffer.length }
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), ContentType: contentType, ...body }),
    )
  }

  async exists(key: string): Promise<boolean> {
    if (!isSafeObjectKey(key)) return false
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }))
      return true
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404 || (error as { name?: string }).name === 'NotFound') return false
      throw error
    }
  }

  async open(key: string): Promise<StoredObject | null> {
    if (!isSafeObjectKey(key)) return null
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }))
      if (!(result.Body instanceof Readable)) return null
      return { stream: result.Body, contentType: result.ContentType ?? null }
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') return null
      throw error
    }
  }

  async delete(key: string): Promise<void> {
    if (!isSafeObjectKey(key)) return
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }))
    } catch {
      // Удаление best-effort: результат определяет основная операция.
    }
  }

  private objectKey(key: string): string {
    if (!isSafeObjectKey(key)) throw new Error(`Недопустимый ключ объекта: ${key}`)
    return this.prefix ? `${this.prefix}/${key}` : key
  }
}
