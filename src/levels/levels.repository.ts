import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';

export type Level = Pick<
  Database['public']['Tables']['levels']['Row'],
  'id' | 'name_he' | 'name_en' | 'slug' | 'sort_order'
>;

@Injectable()
export class LevelsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findAllActive(): Promise<Level[]> {
    const { data, error } = await this.supabase.client
      .from('levels')
      .select('id, name_he, name_en, slug, sort_order')
      .eq('is_active', true)
      .order('sort_order')
      .order('id');

    if (error) {
      throw new InternalServerErrorException('Failed to load levels');
    }

    return data;
  }
}
