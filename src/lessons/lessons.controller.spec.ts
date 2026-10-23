import { Test } from '@nestjs/testing';
import { LessonCalendarService } from '../availability/lesson-calendar.service.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { SaveLessonDto } from './lesson.dto.js';
import { LessonsController } from './lessons.controller.js';
import { LessonsRepository } from './lessons.repository.js';

describe('Teacher lesson creation retry', () => {
  const repository = { teacherId: vi.fn(), savedRequest: vi.fn(), student: vi.fn(), save: vi.fn() };
  const calendar = { assertTeacherTime: vi.fn() };
  let controller: LessonsController;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ providers: [
      LessonsController, { provide: LessonsRepository, useValue: repository }, { provide: LessonCalendarService, useValue: calendar },
    ] }).compile();
    controller = module.get(LessonsController);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    repository.teacherId.mockResolvedValue('teacher');
    repository.save.mockResolvedValue({ id: 'saved-lesson' });
  });
  const user: AuthUser = { sub: 'owner', identityProvider: 'clerk', role: 'teacher', email: 'teacher@example.com' };
  const dto: SaveLessonDto = { requestKey: 'key', studentId: 'student', startsAt: '2026-11-01T10:00:00Z', endsAt: '2026-11-01T11:00:00Z', mode: 'online' };
  it('returns a saved idempotent request before its own reservation makes the calendar look busy', async () => {
    repository.savedRequest.mockResolvedValue({ id: 'saved-lesson' });
    expect(await controller.create(user, dto)).toEqual({ id: 'saved-lesson' });
    expect(calendar.assertTeacherTime).not.toHaveBeenCalled();
    expect(repository.save).toHaveBeenCalledWith(user.sub, dto);
  });
  it('validates the accepted student connection and exact availability before a new booking', async () => {
    repository.savedRequest.mockResolvedValue(null);
    await controller.create(user, dto);
    expect(repository.student).toHaveBeenCalledWith(user.sub, dto.studentId);
    expect(calendar.assertTeacherTime).toHaveBeenCalledWith('teacher', dto.startsAt, dto.endsAt);
    expect(repository.save).toHaveBeenCalledOnce();
  });
});
