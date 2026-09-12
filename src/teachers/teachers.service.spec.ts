import 'reflect-metadata';
import { SearchTeachersDto } from './dto/search-teachers.dto.js';
import {
  PublicTeacher,
  TeachersRepository,
} from './teachers.repository.js';
import { TeachersService } from './teachers.service.js';

describe('TeachersService search', () => {
  it('returns exact pagination metadata while preserving candidate order', async () => {
    const candidate = { id: 'teacher-1' };
    const teacher = { id: 'teacher-1', slug: 'teacher-1' } as PublicTeacher;
    const repository = {
      searchCandidates: vi.fn().mockResolvedValue([candidate]),
      countCandidates: vi.fn().mockResolvedValue(41),
      findPublicByIds: vi.fn().mockResolvedValue([teacher]),
    } as unknown as TeachersRepository;
    const service = new TeachersService(
      repository,
    );
    const query = Object.assign(new SearchTeachersDto(), {
      page: 2,
      limit: 20,
      sort: 'price_asc' as const,
    });

    await expect(service.search(query)).resolves.toEqual({
      items: [teacher],
      page: 2,
      limit: 20,
      hasMore: true,
      meta: {
        page: 2,
        limit: 20,
        total: 41,
        pageCount: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    });
    expect(repository.searchCandidates).toHaveBeenCalledWith(query, 20, 20);
    expect(repository.countCandidates).toHaveBeenCalledWith(query);
  });
});

describe('TeachersService review submission', () => {
  it('submits a draft and notifies the tutor and admin', async () => {
    const teacher = { id: 'teacher-1', profile_status: 'draft' };
    const submitted = { ...teacher, profile_status: 'pending' };
    const repository = {
      findOnboardingByUserId: vi.fn().mockResolvedValue(teacher),
      submitForReview: vi.fn().mockResolvedValue(submitted),
      findReviewDetails: vi.fn().mockResolvedValue({
        headline: 'Math tutor',
        profile: {
          first_name: 'Ada',
          last_name: 'Lovelace',
          contact_email: 'ada@example.com',
          phone: '0500000000',
        },
      }),
    } as unknown as TeachersRepository;
    const emailService = {
      sendTeacherReviewReceived: vi.fn().mockResolvedValue(true),
      sendTeacherReviewSubmitted: vi.fn().mockResolvedValue(true),
    };
    const approvalTokens = {
      create: vi.fn().mockReturnValue('signed-token'),
      approvalUrl: vi.fn().mockReturnValue('https://example.com/approve'),
    };
    const service = new TeachersService(
      repository,
    );

    await expect(service.submitForReview('user-1')).resolves.toBe(submitted);
    expect(repository.submitForReview).toHaveBeenCalledWith(
      'teacher-1',
      'user-1',
    );
    expect(emailService.sendTeacherReviewReceived).not.toHaveBeenCalled();
    expect(emailService.sendTeacherReviewSubmitted).not.toHaveBeenCalled();
    expect(approvalTokens.create).not.toHaveBeenCalled();
  });

  it('does not resubmit or resend email for a pending profile', async () => {
    const teacher = { id: 'teacher-1', profile_status: 'pending' };
    const repository = {
      findOnboardingByUserId: vi.fn().mockResolvedValue(teacher),
      submitForReview: vi.fn(),
      findReviewDetails: vi.fn(),
    } as unknown as TeachersRepository;
    const emailService = {
      sendTeacherReviewReceived: vi.fn(),
      sendTeacherReviewSubmitted: vi.fn(),
    };
    const approvalTokens = { create: vi.fn(), approvalUrl: vi.fn() };
    const service = new TeachersService(
      repository,
    );

    await expect(service.submitForReview('user-1')).resolves.toBe(teacher);
    expect(repository.submitForReview).not.toHaveBeenCalled();
    expect(repository.findReviewDetails).not.toHaveBeenCalled();
    expect(emailService.sendTeacherReviewReceived).not.toHaveBeenCalled();
    expect(emailService.sendTeacherReviewSubmitted).not.toHaveBeenCalled();
    expect(approvalTokens.create).not.toHaveBeenCalled();
  });
});