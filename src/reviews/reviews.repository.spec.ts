import { describe, expect, it, vi } from 'vitest';
import { SupabaseService } from '../database/supabase.service.js';
import { ReviewsRepository } from './reviews.repository.js';

describe('Review API privacy and ownership', () => {
  it.each(['pending', 'rejected', 'published', undefined])('redacts nonpublic fields and %s replies', async (replyStatus) => {
    const source = { id: 'review', rating: 5, body: 'Helpful lesson', created_at: '2030-01-01', updated_at: '2030-01-01',
      student_id: 'private-student', inquiry_id: 'private-inquiry', teacher_reply: 'Teacher reply',
      teacher_reply_status: replyStatus, teacher_reply_at: '2030-01-02' };
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [source], error: null }) };
    const repository = new ReviewsRepository({ client: { from: () => query } } as unknown as SupabaseService);
    const result = await repository.findPublishedByTeacher('teacher', 0, 20);
    expect(query.eq).toHaveBeenCalledWith('teacher_id', 'teacher');
    expect(query.eq).toHaveBeenCalledWith('status', 'published');
    expect(result[0].teacher_reply).toBe(replyStatus === 'published' ? source.teacher_reply : null);
    expect(result[0].teacher_reply_at).toBe(replyStatus === 'published' ? source.teacher_reply_at : null);
    expect(result[0]).not.toHaveProperty('student_id');
    expect(result[0]).not.toHaveProperty('inquiry_id');
    expect(result[0]).not.toHaveProperty('teacher_reply_status');
  });

  it('passes the authenticated internal user identity to owner-controlled RPCs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'review' }], error: null });
    const repository = new ReviewsRepository({ client: { rpc } } as unknown as SupabaseService);
    await repository.updateOwned('owner', 'review', { rating: 4, body: 'Updated' });
    expect(rpc).toHaveBeenLastCalledWith('edit_owned_review', { p_review_id: 'review', p_student_id: 'owner', p_rating: 4, p_body: 'Updated' });
    await repository.deleteOwned('owner', 'review');
    expect(rpc).toHaveBeenLastCalledWith('delete_owned_review', { p_review_id: 'review', p_student_id: 'owner' });
    await repository.reply('teacher-owner', 'review', 'Thank you');
    expect(rpc).toHaveBeenLastCalledWith('reply_to_review', { p_review_id: 'review', p_teacher_user_id: 'teacher-owner', p_body: 'Thank you' });
  });

  it('maps a foreign or missing review to a safe not-found response', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0002' } });
    const repository = new ReviewsRepository({ client: { rpc } } as unknown as SupabaseService);
    await expect(repository.deleteOwned('stranger', 'review')).rejects.toMatchObject({ status: 404 });
  });
});