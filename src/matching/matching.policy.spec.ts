import { TeacherProfile } from '../teachers/teachers.repository.js';
import { MatchingPolicy } from './matching.policy.js';

const teacher = (overrides: Partial<TeacherProfile>): TeacherProfile => ({
  id: 'teacher-a',
  user_id: 'user-a',
  slug: 'teacher-a',
  headline: 'Math teacher',
  bio: 'Bio',
  hourly_price: 100,
  currency: 'ILS',
  years_experience: 5,
  teaches_online: true,
  teaches_in_person: false,
  verification_status: 'verified',
  profile_status: 'published',
  average_rating: 4.5,
  review_count: 10,
  response_rate: 90,
  response_time_minutes: 30,
  is_founder: false,
  created_at: '2020-01-01T00:00:00.000Z',
  updated_at: '2020-01-01T00:00:00.000Z',
  published_at: '2020-01-01T00:00:00.000Z',
  ...overrides,
});

describe('MatchingPolicy', () => {
  it('ranks deterministically and gives only a small exploration bonus', () => {
    const policy = new MatchingPolicy();
    const established = teacher({ id: 'established' });
    const newTeacher = teacher({
      id: 'new-teacher',
      review_count: 0,
      created_at: new Date().toISOString(),
    });

    const result = policy.rank([established, newTeacher], {
      cityId: null,
      budgetMin: 80,
      budgetMax: 120,
      availableTeacherIds: new Set(['established', 'new-teacher']),
    });

    expect(result.map((match) => match.teacher_id)).toEqual([
      'new-teacher',
      'established',
    ]);
    expect(result[0].score - result[1].score).toBeLessThanOrEqual(3);
    expect(result.map((match) => match.rank)).toEqual([1, 2]);
  });
});