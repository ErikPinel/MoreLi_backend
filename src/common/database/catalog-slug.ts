import { BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../database/database.types.js';
import { throwSupabaseError } from './supabase-error.js';

export async function resolveCatalogId(
  client: SupabaseClient<Database>,
  table: 'cities' | 'subjects',
  slug: string | undefined,
  id?: number,
): Promise<number | undefined> {
  if (slug === undefined) return id;
  const { data, error } = await client.from(table)
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throwSupabaseError(error, `Failed to validate ${table} slug`);
  if (!data) throw new BadRequestException(`Unknown or inactive ${table} slug`);
  if (id !== undefined && id !== data.id) {
    throw new BadRequestException(`Conflicting ${table} ID and slug`);
  }
  return data.id;
}