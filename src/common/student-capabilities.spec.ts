import { BadRequestException } from '@nestjs/common';
import { ROLES_KEY } from './decorators/roles.decorator.js';
import { FavoritesController } from '../favorites/favorites.controller.js';
import { FavoritesService } from '../favorites/favorites.service.js';
import { FavoritesRepository } from '../favorites/favorites.repository.js';
import { InquiriesController } from '../inquiries/inquiries.controller.js';
import { MatchingController } from '../matching/matching.controller.js';
import { MatchingPolicy } from '../matching/matching.policy.js';
import { MatchingRepository } from '../matching/matching.repository.js';
import { MatchingService } from '../matching/matching.service.js';
import { RequestsController } from '../requests/requests.controller.js';
import { RequestsRepository } from '../requests/requests.repository.js';
import { RequestsService } from '../requests/requests.service.js';
import { ReviewsController } from '../reviews/reviews.controller.js';
import { TeachersRepository } from '../teachers/teachers.repository.js';

const roles = (target: object) => Reflect.getMetadata(ROLES_KEY, target) as string[];

describe('Teachers keep their student capabilities', () => {
  it('allows teacher accounts on every student-side endpoint', () => {
    expect(roles(FavoritesController)).toEqual(['student', 'teacher']);
    expect(roles(RequestsController)).toEqual(['student', 'teacher']);
    expect(roles(MatchingController.prototype.run)).toEqual(['student', 'teacher']);
    expect(roles(MatchingController.prototype.findForRequest)).toEqual(['student', 'teacher']);
    expect(roles(InquiriesController.prototype.create)).toEqual(['student', 'teacher']);
    for (const handler of ['create', 'findMine', 'update', 'remove'] as const) {
      expect(roles(ReviewsController.prototype[handler])).toEqual(['student', 'teacher']);
    }
  });

  it('keeps teacher-only actions closed to students', () => {
    expect(roles(InquiriesController.prototype.respond)).toEqual(['teacher']);
    expect(roles(InquiriesController.prototype.markViewed)).toEqual(['teacher']);
    expect(roles(ReviewsController.prototype.reply)).toEqual(['teacher']);
    expect(roles(ReviewsController.prototype.findReceived)).toEqual(['teacher']);
  });

  it('refuses to save the account owner\'s own teacher profile as a favorite', async () => {
    const favorites = { add: vi.fn() };
    const teachers = {
      findPublicByIds: vi.fn().mockResolvedValue([{ id: 'own-teacher', slug: 'own' }]),
      findByUserId: vi.fn().mockResolvedValue({ id: 'own-teacher' }),
    };
    const service = new FavoritesService(favorites as unknown as FavoritesRepository, teachers as unknown as TeachersRepository);
    await expect(service.add('user-1', 'own-teacher')).rejects.toBeInstanceOf(BadRequestException);
    expect(favorites.add).not.toHaveBeenCalled();

    teachers.findPublicByIds.mockResolvedValue([{ id: 'other-teacher', slug: 'other' }]);
    await service.add('user-1', 'other-teacher');
    expect(favorites.add).toHaveBeenCalledWith('user-1', 'other-teacher');
  });

  it('never matches a teacher-student with their own teacher profile', async () => {
    const candidate = (id: string) => ({ id, slug: id, hourly_price: 100, average_rating: 5, review_count: 0, response_rate: 100, verification_status: 'verified', teaches_in_person: false, created_at: '2020-01-01T00:00:00Z' });
    const teachers = {
      findByUserId: vi.fn().mockResolvedValue({ id: 'own-teacher' }),
      searchCandidates: vi.fn().mockResolvedValue([candidate('own-teacher'), candidate('other-teacher')]),
      findPublicByIds: vi.fn((ids: string[]) => Promise.resolve(ids.map((id) => ({ id, slug: id })))),
    };
    const matching = { findAvailability: vi.fn().mockResolvedValue([]), persist: vi.fn().mockResolvedValue([]) };
    const requests = { findOwned: vi.fn().mockResolvedValue({ subject_id: 1, city_id: null, online_ok: true, in_person_ok: false, budget_min: null, budget_max: null, desired_start_at: null, goal: 'goal', notes: null }) };
    const service = new MatchingService({} as RequestsService, requests as unknown as RequestsRepository, teachers as unknown as TeachersRepository, matching as unknown as MatchingRepository, new MatchingPolicy());

    const ranked = await service.run('user-1', 'request-1');

    expect(ranked.map((match) => match.teacher_id)).toEqual(['other-teacher']);
    expect(matching.persist).toHaveBeenCalledWith('request-1', [expect.objectContaining({ teacher_id: 'other-teacher' })]);
  });
});
