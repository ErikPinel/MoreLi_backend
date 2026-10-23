import { Test } from '@nestjs/testing';
import { SupabaseService } from '../database/supabase.service.js';
import { ListLessonsDto } from './lesson.dto.js';
import { LessonsRepository } from './lessons.repository.js';

describe('Owned chronological lesson queries', () => {
  const request = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), gt: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), maybeSingle: vi.fn(),
    data: [{ id: 'first' }, { id: 'second' }, { id: 'third' }, { id: 'fourth' }, { id: 'fifth' }], error: null, count: 8 as number | null,
  };
  const teachers = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn() };
  const from = vi.fn((table: string) => {
    if (table === 'lessons') return request;
    if (table === 'teacher_profiles') return teachers;
    throw new Error(`Unexpected table ${table}`);
  });
  let repository: LessonsRepository;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ providers: [
      LessonsRepository, { provide: SupabaseService, useValue: { client: { from } } },
    ] }).compile();
    repository = module.get(LessonsRepository);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    request.count = 8;
    teachers.maybeSingle.mockResolvedValue({ data: { id: 'owned-teacher' }, error: null });
    request.maybeSingle.mockResolvedValue({ data: { id: 'lesson' }, error: null });
  });
  it.each(['student', 'teacher'] as const)('selects exactly the chronological next five on the server for %s', async side => {
    const result = await repository.list('owner', { ...new ListLessonsDto(), side, limit: 5 });
    expect(result.items).toHaveLength(5);
    expect(result).toMatchObject({ total: 8, limit: 5, page: 1, hasMore: true });
    expect(request.eq).toHaveBeenCalledWith(side === 'teacher' ? 'teacher_id' : 'student_id', side === 'teacher' ? 'owned-teacher' : 'owner');
    expect(request.eq).toHaveBeenCalledWith('status', 'scheduled');
    expect(request.gt).toHaveBeenCalledWith('ends_at', expect.any(String));
    expect(request.order.mock.calls).toEqual([['starts_at', { ascending: true, nullsFirst: false }], ['id']]);
    expect(request.range).toHaveBeenCalledWith(0, 4);
    expect(request.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' });
  });
  it('filters a teacher-owned student and uses exclusive week endpoints', async () => {
    await repository.list('owner', { ...new ListLessonsDto(), side: 'teacher', studentId: 'student', view: 'week', from: '2026-10-24T21:00:00Z', to: '2026-10-31T22:00:00Z' });
    expect(request.eq).toHaveBeenCalledWith('teacher_id', 'owned-teacher');
    expect(request.eq).toHaveBeenCalledWith('student_id', 'student');
    expect(request.gt).toHaveBeenCalledWith('ends_at', '2026-10-24T21:00:00Z');
    expect(request.lt).toHaveBeenCalledWith('starts_at', '2026-10-31T22:00:00Z');
  });
  it('does not accept another student filter in student mode, an incomplete week, or an unbounded range', async () => {
    await expect(repository.list('owner', { ...new ListLessonsDto(), studentId: 'other' })).rejects.toThrow('סינון לפי תלמיד');
    await expect(repository.list('owner', { ...new ListLessonsDto(), view: 'week' })).rejects.toThrow('תחילת שבוע');
    await expect(repository.list('owner', { ...new ListLessonsDto(), from: '2026-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z' })).rejects.toThrow('32');
    expect(from).not.toHaveBeenCalled();
  });
  it('never substitutes a partial page length for a failed exact count', async () => {
    request.count = null;
    await expect(repository.list('owner', new ListLessonsDto())).rejects.toThrow('ספירת השיעורים');
  });
  it('limits a personal detail to both of the authenticated account’s participant identities', async () => {
    await repository.detail('owner', 'lesson');
    expect(request.or).toHaveBeenCalledWith('student_id.eq.owner,teacher_id.eq.owned-teacher');
    teachers.maybeSingle.mockResolvedValue({ data: null, error: null });
    vi.clearAllMocks();
    await repository.detail('student', 'lesson');
    expect(request.eq).toHaveBeenCalledWith('student_id', 'student');
    expect(request.or).not.toHaveBeenCalled();
  });
});
