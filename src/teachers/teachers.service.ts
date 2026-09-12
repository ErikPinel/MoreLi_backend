import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ReplaceTeacherLevelsDto,
  ReplaceTeacherServiceAreasDto,
  ReplaceTeacherSubjectsDto,
} from './dto/replace-teacher-collections.dto.js';
import { SearchTeachersDto } from './dto/search-teachers.dto.js';
import { UpdateTeacherDto } from './dto/update-teacher.dto.js';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto.js';
import {
  PublicTeacher,
  TeacherOnboarding,
  TeacherProfile,
  TeachersRepository,
} from './teachers.repository.js';

export type TeacherSearchResult = {
  items: PublicTeacher[];
  page: number;
  limit: number;
  hasMore: boolean;
  meta: {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

@Injectable()
export class TeachersService {
  constructor(
    private readonly teachersRepository: TeachersRepository,
  ) {}

  async search(query: SearchTeachersDto): Promise<TeacherSearchResult> {
    this.validateSearch(query);
    if (query.subjectSlug !== undefined || query.citySlug !== undefined) {
      query = await this.teachersRepository.resolveSearchSlugs(query);
    }
    const offset = (query.page - 1) * query.limit;
    const [pageCandidates, total] = await Promise.all([
      this.teachersRepository.searchCandidates(query, query.limit, offset),
      this.teachersRepository.countCandidates(query),
    ]);
    const pageCount = Math.ceil(total / query.limit);
    const hasMore = query.page < pageCount;
    const teachers = await this.teachersRepository.findPublicByIds(
      pageCandidates.map((teacher) => teacher.id),
    );
    const byId = new Map(teachers.map((teacher) => [teacher.id, teacher]));

    return {
      items: pageCandidates
        .map((candidate) => byId.get(candidate.id))
        .filter((teacher): teacher is PublicTeacher => teacher !== undefined),
      page: query.page,
      limit: query.limit,
      hasMore,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        pageCount,
        hasNextPage: hasMore,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  findPublicBySlug(slug: string): Promise<PublicTeacher> {
    return this.teachersRepository.findPublicBySlug(slug);
  }

  async findMe(userId: string): Promise<TeacherOnboarding> {
    const teacher = await this.teachersRepository.findOnboardingByUserId(userId);
    if (!teacher) throw new NotFoundException('Teacher profile not found');
    return teacher;
  }

  async createDraft(
    userId: string,
    acceptTerms: boolean,
  ): Promise<TeacherProfile> {
    const existing = await this.teachersRepository.findByUserId(userId);
    if (existing) return existing;
    return this.teachersRepository.createDraft(
      userId,
      `teacher-${userId.replaceAll('-', '').slice(0, 12)}`,
      acceptTerms,
    );
  }

  async updateMe(userId: string, dto: UpdateTeacherDto): Promise<TeacherProfile> {
    const teacher = await this.findMe(userId);
    return this.teachersRepository.updateOwned(teacher.id, userId, dto);
  }

  submitOnboarding(userId: string, dto: SubmitOnboardingDto): Promise<TeacherProfile> {
    if (!dto.teachesOnline && !dto.teachesInPerson) throw new BadRequestException('בחרו לפחות אופן לימוד אחד.');
    if (dto.teachesInPerson && !dto.citySlugs.length) throw new BadRequestException('בחרו עיר לשיעורים פרונטליים.');
    if (!dto.avatarPath.startsWith(`${userId}/`)) throw new BadRequestException('תמונת הפרופיל חייבת להיות שייכת לחשבון שלך.');
    for (const slot of dto.slots) {
      if (slot.startTime >= slot.endTime || (slot.timezone && slot.timezone !== 'Asia/Jerusalem') || slot.isActive === false) {
        throw new BadRequestException('יש לבחור חלון זמן פעיל שבו שעת הסיום מאוחרת משעת ההתחלה, לפי שעון ישראל.');
      }
    }
    return this.teachersRepository.submitOnboarding(userId, dto);
  }

  async replaceSubjects(userId: string, dto: ReplaceTeacherSubjectsDto) {
    const ids = dto.subjects.flatMap((subject) => subject.subjectId === undefined ? [] : [subject.subjectId]);
    this.assertUnique(ids, 'subjects');
    const teacher = await this.findMe(userId);
    return this.teachersRepository.replaceSubjects(teacher.id, dto);
  }

  async replaceLevels(userId: string, dto: ReplaceTeacherLevelsDto) {
    const teacher = await this.findMe(userId);
    return this.teachersRepository.replaceLevels(teacher.id, dto);
  }

  async replaceServiceAreas(
    userId: string,
    dto: ReplaceTeacherServiceAreasDto,
  ) {
    const teacher = await this.findMe(userId);
    return this.teachersRepository.replaceServiceAreas(teacher.id, dto);
  }

  async submitForReview(userId: string): Promise<TeacherProfile> {
    const teacher = await this.findMe(userId);
    if (
      teacher.profile_status === 'pending' ||
      teacher.profile_status === 'published'
    ) {
      return teacher as TeacherProfile;
    }
    return this.teachersRepository.submitForReview(
      teacher.id,
      userId,
    );
  }

  private validateSearch(query: SearchTeachersDto): void {
    if (!query.onlineOk && !query.inPersonOk) {
      throw new BadRequestException('At least one teaching mode is required');
    }
    if (
      query.budgetMin !== undefined &&
      query.budgetMax !== undefined &&
      query.budgetMin > query.budgetMax
    ) {
      throw new BadRequestException('budgetMin cannot exceed budgetMax');
    }
  }

  private assertUnique(values: number[], label: string): void {
    if (new Set(values).size !== values.length) {
      throw new BadRequestException(`${label} must be unique`);
    }
  }
}