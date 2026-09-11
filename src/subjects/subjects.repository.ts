import { Injectable, NotFoundException } from '@nestjs/common';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';

export type Subject = Pick<
  Database['public']['Tables']['subjects']['Row'],
  'id' | 'parent_id' | 'name_he' | 'name_en' | 'slug' | 'sort_order'
>;

@Injectable()
export class SubjectsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findAllActive(): Promise<Subject[]> {
    const { data, error } = await this.supabase.client
      .from('subjects')
      .select('id, parent_id, name_he, name_en, slug, sort_order')
      .eq('is_active', true)
      .order('sort_order')
      .order('id');

    if (error) throw error;
    return data;
  }

  async findActiveBySlug(slug: string): Promise<Subject> {
    const { data, error } = await this.supabase.client
      .from('subjects')
      .select('id, parent_id, name_he, name_en, slug, sort_order')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new NotFoundException('Subject not found');
    return data;
  }
}