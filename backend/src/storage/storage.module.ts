import { Module } from '@nestjs/common'
import { FileReferenceService } from './file-reference.service.js'
import { LocalObjectStorage } from './local-object-storage.js'
import { ObjectStorage } from './object-storage.js'
import { S3ObjectStorage } from './s3-object-storage.js'
import { StoredFileReferenceService } from './stored-file-reference.service.js'

/** STORAGE_DRIVER=s3|local; без явного значения S3 включается, когда задан S3_BUCKET. */
const storageDriver = (): 's3' | 'local' => {
  const configured = String(process.env.STORAGE_DRIVER || '').toLowerCase()
  if (configured === 's3' || configured === 'local') return configured
  return process.env.S3_BUCKET ? 's3' : 'local'
}

@Module({
  providers: [
    {
      provide: ObjectStorage,
      useFactory: (): ObjectStorage => (storageDriver() === 's3' ? new S3ObjectStorage() : new LocalObjectStorage()),
    },
    { provide: FileReferenceService, useClass: StoredFileReferenceService },
  ],
  exports: [ObjectStorage, FileReferenceService],
})
export class StorageModule {}
