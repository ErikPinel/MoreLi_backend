import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TeachersRepository } from '../teachers/teachers.repository.js';
import { SupabaseService } from '../database/supabase.service.js';
import {
  CreateUploadUrlDto,
  StorageBucket,
  StorageObjectDto,
} from './dto/storage.dto.js';

@Injectable()
export class StorageService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly teachersRepository: TeachersRepository,
  ) {}

  async createUploadUrl(userId: string, dto: CreateUploadUrlDto) {
    const safeName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120);
    if (!safeName || !/\.(jpe?g|png|webp)$/i.test(safeName)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }
    const path = `${userId}/${randomUUID()}-${safeName}`;
    const { data, error } = await this.supabase.client.storage
      .from(dto.bucket)
      .createSignedUploadUrl(path);
    if (error) throw new BadRequestException('Failed to create upload URL');
    return { ...data, bucket: dto.bucket, path };
  }

  async createReadUrl(userId: string, dto: StorageObjectDto) {
    this.assertOwned(userId, dto.path);
    return this.sign(dto.bucket, dto.path);
  }

  async remove(userId: string, dto: StorageObjectDto) {
    this.assertOwned(userId, dto.path);
    const { error } = await this.supabase.client.storage
      .from(dto.bucket)
      .remove([dto.path]);
    if (error) throw new BadRequestException('Failed to remove storage object');
    return { removed: true };
  }

  async createPublicAvatarUrl(slug: string) {
    const teacher = await this.teachersRepository.findPublicBySlug(slug);
    const profile = teacher.profile as { avatar_path: string | null };
    if (!profile.avatar_path) throw new NotFoundException('Avatar not found');
    return this.sign('teacher-avatars', profile.avatar_path);
  }

  private async sign(bucket: StorageBucket, path: string) {
    const { data, error } = await this.supabase.client.storage
      .from(bucket)
      .createSignedUrl(path, 3600);
    if (error) throw new NotFoundException('Storage object not found');
    return data;
  }

  private assertOwned(userId: string, path: string): void {
    if (!path.startsWith(`${userId}/`)) {
      throw new BadRequestException('Storage path must belong to the current user');
    }
  }
}