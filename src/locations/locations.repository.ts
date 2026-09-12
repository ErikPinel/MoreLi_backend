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
    const cities: City[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.supabase.client
        .from('cities')
        .select('id, name_he, name_en, slug, latitude, longitude')
        .eq('is_active', true)
        .order('name_he')
        .order('id')
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      cities.push(...data);
      if (data.length < pageSize) return cities;
    }
  }
}