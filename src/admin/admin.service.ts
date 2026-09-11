import { Injectable } from '@nestjs/common';
import { AdminRepository } from './admin.repository.js';
import {
  ListAdminReviewsDto,
  ListAdminTeachersDto,
  ModerateReviewDto,
  ModerateTeacherDto,
} from './dto/admin.dto.js';

@Injectable()
export class AdminService {
  constructor(private readonly adminRepository: AdminRepository) {}

  async findTeachers(query: ListAdminTeachersDto) {
    const items = await this.adminRepository.findTeachers(
      query,
      (query.page - 1) * query.limit,
      query.limit + 1,
    );
    return this.page(items, query.page, query.limit);
  }

  moderateTeacher(teacherId: string, dto: ModerateTeacherDto) {
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

  private page<T>(items: T[], page: number, limit: number) {
    return {
      items: items.slice(0, limit),
      page,
      limit,
      hasMore: items.length > limit,
    };
  }
}