import { Injectable } from '@nestjs/common';
import { TeachersRepository } from '../teachers/teachers.repository.js';
import { CreateReviewDto, ListReviewsDto } from './dto/review.dto.js';
import { Review, ReviewsRepository } from './reviews.repository.js';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviewsRepository: ReviewsRepository,
    private readonly teachersRepository: TeachersRepository,
  ) {}

  create(userId: string, dto: CreateReviewDto): Promise<Review> {
    return this.reviewsRepository.create(userId, dto);
  }

  findMine(userId: string): Promise<Review[]> {
    return this.reviewsRepository.findOwned(userId);
  }

  async findPublic(slug: string, query: ListReviewsDto) {
    const teacher = await this.teachersRepository.findPublicBySlug(slug);
    const reviews = await this.reviewsRepository.findPublishedByTeacher(
      teacher.id,
      (query.page - 1) * query.limit,
      query.limit + 1,
    );
    return {
      items: reviews.slice(0, query.limit),
      page: query.page,
      limit: query.limit,
      hasMore: reviews.length > query.limit,
    };
  }
}