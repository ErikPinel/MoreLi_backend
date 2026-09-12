import { Body, Controller, Delete, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { CreateUploadUrlDto, StorageObjectDto } from './dto/storage.dto.js';
import { StorageService } from './storage.service.js';

@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload-url')
  @Roles('student', 'teacher')
  createUploadUrl(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadUrlDto,
  ) {
    this.assertBucketAccess(user, dto.bucket);
    return this.storageService.createUploadUrl(user.sub, dto);
  }

  @Post('read-url')
  @Roles('student', 'teacher')
  createReadUrl(
    @CurrentUser() user: AuthUser,
    @Body() dto: StorageObjectDto,
  ) {
    this.assertBucketAccess(user, dto.bucket);
    return this.storageService.createReadUrl(user.sub, dto);
  }

  @Delete('object')
  @Roles('student', 'teacher')
  remove(
    @CurrentUser() user: AuthUser,
    @Body() dto: StorageObjectDto,
  ) {
    this.assertBucketAccess(user, dto.bucket);
    return this.storageService.remove(user.sub, dto);
  }

  @Public()
  @Get('teachers/:slug/avatar-url')
  createPublicAvatarUrl(@Param('slug') slug: string) {
    return this.storageService.createPublicAvatarUrl(slug);
  }

  private assertBucketAccess(user: AuthUser, bucket: string) {
    if (user.role !== 'teacher' && bucket !== 'teacher-avatars') {
      throw new ForbiddenException('ניתן להעלות תמונת פרופיל בלבד לפני פתיחת חשבון מורה.');
    }
  }
}