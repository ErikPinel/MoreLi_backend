import { Injectable } from '@nestjs/common';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';

export type City = Pick<
  Database['public']['Tables']['cities']['Row'],
  'id' | 'name_he' | 'name_en' | 'slug' | 'latitude' | 'longitude'
>;

@Injectable()
export class LocationsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findAllActive(): Promise<City[]> {
    const { data, error } = await this.supabase.client
      .from('cities')
      .select('id, name_he, name_en, slug, latitude, longitude')
      .eq('is_active', true)
      .order('name_he')
      .order('id');

    if (error) throw error;
    return data;
  }
}