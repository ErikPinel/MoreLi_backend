import { TeachersRepository } from '../teachers/teachers.repository.js';
import { AvailabilityRepository } from './availability.repository.js';
import { AvailabilityService } from './availability.service.js';

describe('AvailabilityService', () => {
  it('checks an instant in the slot timezone', async () => {
    const availabilityRepository = {
      findByTeacherId: vi.fn().mockResolvedValue([
        {
          id: 1,
          teacher_id: 'teacher-id',
          day_of_week: 4,
          start_time: '17:00:00',
          end_time: '19:00:00',
          timezone: 'Asia/Jerusalem',
          is_active: true,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ]),
    } as unknown as AvailabilityRepository;
    const teachersRepository = {
      findPublicBySlug: vi.fn().mockResolvedValue({
        id: 'teacher-id',
        slug: 'teacher',
      }),
    } as unknown as TeachersRepository;
    const service = new AvailabilityService(
      availabilityRepository,
      teachersRepository,
    );

    await expect(
      service.findPublic('teacher', '2026-09-10T15:00:00.000Z'),
    ).resolves.toMatchObject({ available: true });
  });
});