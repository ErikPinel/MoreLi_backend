import { Test } from '@nestjs/testing';
import { TeachersRepository } from '../teachers/teachers.repository.js';
import { AvailabilityRepository } from './availability.repository.js';
import { AvailabilityService } from './availability.service.js';

describe('AvailabilityService', () => {
  const availability = { findByTeacherId: vi.fn(), calendarTeacher: vi.fn() };
  const teachers = { findPublicBySlug: vi.fn(), findByUserId: vi.fn() };
  let service: AvailabilityService;
  beforeEach(async () => {
    vi.clearAllMocks();
    availability.findByTeacherId.mockResolvedValue([{
      id: 1, teacher_id: 'teacher-id', day_of_week: 4, start_time: '17:00:00', end_time: '19:00:00',
      timezone: 'Asia/Jerusalem', is_active: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }]);
    availability.calendarTeacher.mockResolvedValue({ id: 'teacher-id', availability_customized: true });
    teachers.findPublicBySlug.mockResolvedValue({ id: 'teacher-id', slug: 'teacher' });
    teachers.findByUserId.mockResolvedValue({ id: 'teacher-id', availability_customized: false });
    const module = await Test.createTestingModule({ providers: [
      AvailabilityService,
      { provide: AvailabilityRepository, useValue: availability },
      { provide: TeachersRepository, useValue: teachers },
    ] }).compile();
    service = module.get(AvailabilityService);
  });
  it('checks an instant in the slot timezone', async () => {
    await expect(service.findPublic('teacher', '2026-09-10T15:00:00.000Z')).resolves.toMatchObject({ available: true });
  });
  it('supplies exactly five default days for an unconfigured teacher', async () => {
    expect((await service.findMine('owner')).map(slot => [slot.day_of_week, slot.start_time, slot.end_time])).toEqual(
      [0, 1, 2, 3, 4].map(day => [day, '09:00:00', '21:00:00']));
    expect(availability.findByTeacherId).not.toHaveBeenCalled();
  });
  it('does not replace an explicitly closed customized schedule with defaults', async () => {
    teachers.findByUserId.mockResolvedValue({ id: 'teacher-id', availability_customized: true });
    availability.findByTeacherId.mockResolvedValue([]);
    expect(await service.findMine('owner')).toEqual([]);
  });
  it('keeps public recurring defaults consistent with the teacher editor', async () => {
    availability.calendarTeacher.mockResolvedValue({ id: 'teacher-id', availability_customized: false });
    expect((await service.findPublic('teacher')).slots).toHaveLength(5);
    expect((await service.findPublic('teacher', '2026-10-23T10:00:00+03:00')).available).toBe(false);
  });
});
