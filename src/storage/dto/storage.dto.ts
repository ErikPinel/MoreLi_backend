import { IsIn, IsString, MaxLength } from 'class-validator';

export type StorageBucket = 'teacher-avatars' | 'teacher-gallery';

export class CreateUploadUrlDto {
  @IsIn(['teacher-avatars', 'teacher-gallery'])
  bucket: StorageBucket;

  @IsString()
  @MaxLength(255)
  fileName: string;
}

export class StorageObjectDto {
  @IsIn(['teacher-avatars', 'teacher-gallery'])
  bucket: StorageBucket;

  @IsString()
  @MaxLength(500)
  path: string;
}