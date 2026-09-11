import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { CreateReviewDto, ListReviewsDto } from './dto/review.dto.js';
import { Review } from './reviews.repository.js';
import { ReviewsService } from './reviews.service.js';

@Controller()
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post('reviews')
  @Roles('student')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateReviewDto,
  ): Promise<Review> {
    return this.reviewsService.create(user.sub, dto);
  }

  @Get('reviews/me')
  @Roles('student')
  findMine(@CurrentUser() user: AuthUser): Promise<Review[]> {
    return this.reviewsService.findMine(user.sub);
  }

  @Public()
  @Get('teachers/:slug/reviews')
  findPublic(
    @Param('slug') slug: string,
    @Query() query: ListReviewsDto,
  ) {
    return this.reviewsService.findPublic(slug, query);
  }
}