import { Module } from '@nestjs/common'
import { FileReferenceService } from './file-reference.service.js'
import { LocalObjectStorage } from './local-object-storage.js'
import { ObjectStorage } from './object-storage.js'
import { StoredFileReferenceService } from './stored-file-reference.service.js'

@Module({
  providers: [
    { provide: ObjectStorage, useClass: LocalObjectStorage },
    { provide: FileReferenceService, useClass: StoredFileReferenceService },
  ],
  exports: [ObjectStorage, FileReferenceService],
})
export class StorageModule {}
