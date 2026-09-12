import 'reflect-metadata';
import { InquiriesRepository } from './inquiries.repository.js';
import { InquiriesService } from './inquiries.service.js';

describe('InquiriesService', () => {
  it('persists a scheduled request before notifying both parties', async () => {
    const inquiry = { id: 'inquiry-1' };
    const context = {
      requested_start_at: '2030-01-01T10:00:00.000Z',
      requested_end_at: '2030-01-01T11:00:00.000Z',
      lesson_mode: 'online',
      student: {
        first_name: 'Dana',
        last_name: 'Levi',
        contact_email: 'dana@example.com',
        phone: '0500000000',
      },
      teacher: {
        profile: {
          first_name: 'Ari',
          last_name: 'Cohen',
          contact_email: 'ari@example.com',
          phone: '0520000000',
        },
      },
    };
    const repository = {
      create: vi.fn().mockResolvedValue(inquiry),
      findDeliveryContext: vi.fn().mockResolvedValue(context),
    } as unknown as InquiriesRepository;
    const service = new InquiriesService(repository);

    await expect(
      service.create('student-1', {
        contactSharingConsent: true,
        teacherId: 'd26d1299-507c-4f98-9f1c-bf09026ddd79',
        message: 'Please confirm this lesson',
        requestedStartAt: '2030-01-01T10:00:00.000Z',
        requestedEndAt: '2030-01-01T11:00:00.000Z',
        lessonMode: 'online',
      }),
    ).resolves.toBe(inquiry);
    expect(repository.create).toHaveBeenCalled();
    expect(repository.findDeliveryContext).not.toHaveBeenCalled();
  });

  it('rejects an incomplete schedule before persistence', async () => {
    const repository = { create: vi.fn() } as unknown as InquiriesRepository;
    const service = new InquiriesService(repository);

    await expect(
      service.create('student-1', {
        contactSharingConsent: true,
        teacherId: 'd26d1299-507c-4f98-9f1c-bf09026ddd79',
        message: 'Please confirm this lesson',
        requestedStartAt: '2030-01-01T10:00:00.000Z',
      }),
    ).rejects.toThrow('Lesson time and mode must be provided together');
    expect(repository.create).not.toHaveBeenCalled();
  });
});