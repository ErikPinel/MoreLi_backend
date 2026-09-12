import { BadRequestException, Injectable } from '@nestjs/common';
import { ApprovalTokenService } from '../email/approval-token.service.js';
import { AdminRepository } from './admin.repository.js';
import {
  ListAdminReviewsDto,
  ListAdminTeachersDto,
  ModerateReviewDto,
  ModerateTeacherDto,
  CatalogItemDto,
  ReplaceCitiesDto,
  ReplaceProfessionsDto,
} from './dto/admin.dto.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly adminRepository: AdminRepository,
    private readonly approvalTokens: ApprovalTokenService,
  ) {}

  async previewTeacherApproval(token: string) {
    const { teacherId, expiresAt } = this.approvalTokens.verify(token);
    const teacher = await this.adminRepository.findTeacherReview(teacherId);
    return {
      teacherId: teacher.id,
      name: [teacher.profile.first_name, teacher.profile.last_name]
        .filter(Boolean)
        .join(' '),
      headline: teacher.headline,
      profileStatus: teacher.profile_status,
      verificationStatus: teacher.verification_status,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  async approveTeacherByEmail(token: string, actorId: string) {
    const { teacherId } = this.approvalTokens.verify(token);
    const approved = await this.adminRepository.approvePendingTeacher(teacherId, actorId);
    return { approved: true, teacherId: approved.id };
  }

  approveTeacher(teacherId: string, actorId: string) {
    return this.adminRepository.approvePendingTeacher(teacherId, actorId);
  }

  rejectTeacher(teacherId: string, actorId: string, reason: string) {
    return this.adminRepository.rejectPendingTeacher(teacherId, actorId, reason);
  }

  async findTeachers(query: ListAdminTeachersDto) {
    const items = await this.adminRepository.findTeachers(
      query,
      (query.page - 1) * query.limit,
      query.limit + 1,
    );
    return this.page(items, query.page, query.limit);
  }

  moderateTeacher(teacherId: string, dto: ModerateTeacherDto) {
    if (dto.profileStatus === 'published' || dto.verificationStatus === 'verified') {
      throw new BadRequestException('Use the pending teacher approval endpoint to publish or verify a tutor');
    }
    return this.adminRepository.moderateTeacher(teacherId, dto);
  }

  async findReviews(query: ListAdminReviewsDto) {
    const items = await this.adminRepository.findReviews(
      query,
      (query.page - 1) * query.limit,
      query.limit + 1,
    );
    return this.page(items, query.page, query.limit);
  }

  moderateReview(reviewId: string, dto: ModerateReviewDto) {
    return this.adminRepository.moderateReview(reviewId, dto);
  }

  replaceProfessions(dto: ReplaceProfessionsDto) {
    const professions = this.normalizeCatalog(dto.professions, 'Professions');
    return this.adminRepository.replaceProfessions(professions);
  }

  replaceCities(dto: ReplaceCitiesDto) {
    const cities = this.normalizeCatalog(dto.cities, 'Cities');
    return this.adminRepository.replaceCities(cities);
  }

  private normalizeCatalog(items: CatalogItemDto[], label: string) {
    const normalized = items.map((item) => ({
      name_he: item.name_he.trim(),
      slug: item.slug.trim().toLowerCase(),
    }));
    if (normalized.some((item) => !item.name_he || !item.slug)) {
      throw new BadRequestException(`${label} cannot contain blank values`);
    }
    if (new Set(normalized.map((item) => item.name_he)).size !== normalized.length) {
      throw new BadRequestException(`${label} names must be unique`);
    }
    if (new Set(normalized.map((item) => item.slug)).size !== normalized.length) {
      throw new BadRequestException(`${label} slugs must be unique`);
    }
    return normalized;
  }

  private page<T>(items: T[], page: number, limit: number) {
    return {
      items: items.slice(0, limit),
      page,
      limit,
      hasMore: items.length > limit,
    };
  }
}