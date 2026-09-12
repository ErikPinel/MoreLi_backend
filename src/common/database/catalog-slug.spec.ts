import { BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../database/database.types.js';
import { resolveCatalogId } from './catalog-slug.js';

describe('resolveCatalogId', () => {
  function setup(data: { id: number } | null) {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(query) };
    return { query, client: client as unknown as SupabaseClient<Database> };
  }

  it('resolves the exact active slug to its stored ID', async () => {
    const { client, query } = setup({ id: 42 });
    await expect(resolveCatalogId(client, 'cities', 'jerusalem')).resolves.toBe(42);
    expect(query.eq).toHaveBeenCalledWith('slug', 'jerusalem');
    expect(query.eq).toHaveBeenCalledWith('is_active', true);
  });

  it('rejects unknown or inactive slugs', async () => {
    const { client } = setup(null);
    await expect(resolveCatalogId(client, 'subjects', 'missing')).rejects.toThrow(BadRequestException);
  });

  it('rejects conflicting IDs and slugs', async () => {
    const { client } = setup({ id: 42 });
    await expect(resolveCatalogId(client, 'cities', 'jerusalem', 9)).rejects.toThrow(BadRequestException);
  });

  it('preserves legacy ID callers without performing a lookup', async () => {
    const { client } = setup(null);
    await expect(resolveCatalogId(client, 'subjects', undefined, 7)).resolves.toBe(7);
    expect(client.from).not.toHaveBeenCalled();
  });
});