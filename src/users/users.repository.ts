import { resolveCatalogId } from '../common/database/catalog-slug.js';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';

export type Profile = Database['public']['Tables']['profiles']['Row'];

@Injectable()
export class UsersRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findById(userId: string): Promise<Profile> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Profile not found');
    return data;
  }

  async update(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    const updates: Database['public']['Tables']['profiles']['Update'] = {};
    if (dto.firstName !== undefined) updates.first_name = dto.firstName.trim();
    if (dto.lastName !== undefined) updates.last_name = dto.lastName.trim();
    if (dto.contactEmail !== undefined) {
      updates.contact_email = dto.contactEmail.trim().toLowerCase();
    }
    if (dto.phone !== undefined) updates.phone = dto.phone.trim() || null;
    if (dto.citySlug !== undefined || dto.cityId !== undefined) {
      updates.city_id = await resolveCatalogId(this.supabase.client, 'cities', dto.citySlug, dto.cityId);
    }
    if (dto.avatarPath !== undefined) {
      updates.avatar_path = dto.avatarPath.trim() || null;
    }

    const { data, error } = await this.supabase.client
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Profile not found');
    return data;
  }

  async deleteAccount(
    userId: string,
    identityProvider: 'clerk' | 'supabase',
  ): Promise<void> {
    const { error: unpublishError } = await this.supabase.client
      .from('teacher_profiles')
      .update({ profile_status: 'draft' })
      .eq('user_id', userId);
    if (unpublishError) throw unpublishError;

    for (const bucket of ['teacher-avatars', 'teacher-gallery']) {
      const { data, error } = await this.supabase.client.storage
        .from(bucket)
        .list(userId, { limit: 1000 });
      if (error) throw error;
      if (data.length > 0) {
        const { error: removeError } = await this.supabase.client.storage
          .from(bucket)
          .remove(data.map((object) => `${userId}/${object.name}`));
        if (removeError) throw removeError;
      }
    }

    if (identityProvider === 'clerk') {
      const { error: deleteProfileError } = await this.supabase.client
        .from('profiles')
        .delete()
        .eq('id', userId);
      if (deleteProfileError) throw deleteProfileError;
      return;
    }

    const { error: deleteUserError } =
      await this.supabase.client.auth.admin.deleteUser(userId);
    if (deleteUserError) throw deleteUserError;
  }
}