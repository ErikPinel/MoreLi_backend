import { describe, expect, it, vi } from 'vitest';
import { SupabaseService } from '../database/supabase.service.js';
import { RequestsRepository } from './requests.repository.js';

describe('Owned request lifecycle', () => {
  it.each(['closeOwned', 'reopenOwned'] as const)('%s restricts transitions to the owner and source state', async (method) => {
    const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'request' }, error: null }) };
    const repository = new RequestsRepository({ client: { from: () => query } } as unknown as SupabaseService);
    await repository[method]('owner', 'request');
    expect(query.eq).toHaveBeenCalledWith('student_id', 'owner');
    expect(query.eq).toHaveBeenCalledWith('id', 'request');
    if (method === 'reopenOwned') {
      expect(query.eq).toHaveBeenCalledWith('status', 'closed');
      expect(query.update).toHaveBeenCalledWith({ status: 'open' });
    } else {
      expect(query.in).toHaveBeenCalledWith('status', ['open', 'matched']);
    }
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(repository[method]('stranger', 'request')).rejects.toMatchObject({ status: 404 });
  });
});