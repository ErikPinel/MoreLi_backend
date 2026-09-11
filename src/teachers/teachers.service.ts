import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ReplaceTeacherLevelsDto,
  ReplaceTeacherServiceAreasDto,
  ReplaceTeacherSubjectsDto,
} from './dto/replace-teacher-collections.dto.js';
import { SearchTeachersDto } from './dto/search-teachers.dto.js';
import { UpdateTeacherDto } from './dto/update-teacher.dto.js';
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
};

@Injectable()
export class TeachersService {
  constructor(private readonly teachersRepository: TeachersRepository) {}

  async search(query: SearchTeachersDto): Promise<TeacherSearchResult> {
    this.validateSearch(query);
    const offset = (query.page - 1) * query.limit;
    const candidates = await this.teachersRepository.searchCandidates(
      query,
      query.limit + 1,
      offset,
    );
    const hasMore = candidates.length > query.limit;
    const pageCandidates = candidates.slice(0, query.limit);
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

  async replaceSubjects(userId: string, dto: ReplaceTeacherSubjectsDto) {
    this.assertUnique(dto.subjects.map((subject) => subject.subjectId), 'subjects');
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

  async publish(userId: string): Promise<TeacherProfile> {
    const teacher = await this.findMe(userId);
    return this.teachersRepository.publish(teacher.id, userId);
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