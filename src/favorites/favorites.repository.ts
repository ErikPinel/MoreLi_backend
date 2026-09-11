import { Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';

export type Favorite = Database['public']['Tables']['favorites']['Row'];

@Injectable()
export class FavoritesRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async add(userId: string, teacherId: string): Promise<Favorite> {
    const { data, error } = await this.supabase.client
      .from('favorites')
      .upsert(
        { student_id: userId, teacher_id: teacherId },
        { onConflict: 'student_id,teacher_id' },
      )
      .select()
      .single();
    if (error) throwSupabaseError(error, 'Failed to add favorite');
    return data;
  }

  async remove(userId: string, teacherId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('favorites')
      .delete()
      .eq('student_id', userId)
      .eq('teacher_id', teacherId);
    if (error) throwSupabaseError(error, 'Failed to remove favorite');
  }

  async findTeacherIds(userId: string): Promise<string[]> {
    const { data, error } = await this.supabase.client
      .from('favorites')
      .select('teacher_id')
      .eq('student_id', userId)
      .order('created_at', { ascending: false });
    if (error) throwSupabaseError(error, 'Failed to load favorites');
    return data.map((favorite) => favorite.teacher_id);
  }
}