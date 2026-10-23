import { describe, expect, it, vi } from 'vitest';
import { SupabaseService } from '../database/supabase.service.js';
import { ReviewsRepository } from './reviews.repository.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReviewDto } from './dto/review.dto.js';

describe('Review API privacy and ownership', () => {
  it('submits an authenticated rating directly for a teacher without an inquiry or comment', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ id: 'review', rating: 3, body: null }], error: null });
    const repository = new ReviewsRepository({ client: { rpc } } as unknown as SupabaseService);
    await repository.create('student-owner', { teacherId: 'teacher', rating: 3 });
    expect(rpc).toHaveBeenCalledWith('submit_teacher_review', { p_student_id: 'student-owner', p_teacher_id: 'teacher', p_rating: 3, p_body: '' });
    await repository.create('student-owner', { inquiryId: 'legacy-connection', rating: 4 });
    expect(rpc).toHaveBeenLastCalledWith('submit_verified_review', { p_student_id: 'student-owner', p_inquiry_id: 'legacy-connection', p_rating: 4, p_body: '' });
    await expect(repository.create('student-owner', { rating: 4 })).rejects.toMatchObject({ status: 400 });
    await expect(repository.create('student-owner', { teacherId: 'teacher', inquiryId: 'connection', rating: 4 })).rejects.toMatchObject({ status: 400 });
  });

  it('validates a mandatory integer rating, optional comment and teacher target at the API boundary', async () => {
    const teacherId = '00000000-0000-4000-8000-000000000001';
    for (const rating of [1, 2, 3, 4, 5]) expect(await validate(plainToInstance(CreateReviewDto, { teacherId, rating }))).toEqual([]);
    for (const rating of [undefined, null, 0, 6, 2.5, '5']) expect((await validate(plainToInstance(CreateReviewDto, { teacherId, rating }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateReviewDto, { rating: 5 }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateReviewDto, { teacherId, rating: 5, body: 'x'.repeat(3001) }))).length).toBeGreaterThan(0);
  });
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