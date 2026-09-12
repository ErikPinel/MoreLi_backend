import { describe, expect, it, vi } from 'vitest';
import { InquiriesRepository } from './inquiries.repository.js';
import { SupabaseService } from '../database/supabase.service.js';
import { ListInquiriesDto } from './dto/inquiry.dto.js';

describe('inquiry contact privacy', () => {
  it.each(['sent', 'viewed', 'declined', 'expired', 'accepted'])('scopes both sides and handles %s contacts', async (status) => {
    for (const side of ['student', 'teacher'] as const) {
      const contact = { first_name: 'Test', phone: '0500000000', contact_email: 'fixture@example.com' };
      const source = { id: 'inquiry', status, student: contact, teacher: { profile: contact } };
      const query = {
        select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [source], error: null })),
      };
      const from = vi.fn().mockReturnValue(query);
      const repository = new InquiriesRepository({ client: { from } } as unknown as SupabaseService);
      const result = await repository.findAll('student-id', 'teacher-id', { side } as ListInquiriesDto, 0, 51);
      expect(query.eq).toHaveBeenCalledWith(side === 'teacher' ? 'teacher_id' : 'student_id', `${side}-id`);
      const serialized = JSON.stringify(result);
      expect(serialized.includes(contact.contact_email)).toBe(status === 'accepted');
      expect(serialized.includes(contact.phone)).toBe(status === 'accepted');
      expect(source.student.phone).toBe(contact.phone);
    }
  });

  it('does not query contacts without an owned teacher profile', async () => {
    const from = vi.fn();
    const repository = new InquiriesRepository({ client: { from } } as unknown as SupabaseService);
    expect(await repository.findAll('student-id', null, { side: 'teacher' } as ListInquiriesDto, 0, 51)).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });
});