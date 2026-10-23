import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { CreateReviewDto, ListReviewsDto, ModerateReviewReplyDto, ReviewReplyDto, UpdateReviewDto } from './dto/review.dto.js';
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

  @Get('reviews/teacher')
  @Roles('teacher')
  findReceived(@CurrentUser() user: AuthUser, @Query() query: ListReviewsDto) {
    return this.reviewsService.findReceived(user.sub, query);
  }

  @Patch('reviews/:id')
  @Roles('student')
  update(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateReviewDto) {
    return this.reviewsService.update(user.sub, id, dto);
  }

  @Delete('reviews/:id')
  @Roles('student')
  remove(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.reviewsService.remove(user.sub, id);
  }

  @Post('reviews/:id/reply')
  @Roles('teacher')
  reply(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ReviewReplyDto) {
    return this.reviewsService.reply(user.sub, id, dto.body);
  }

  @Delete('reviews/:id/reply')
  @Roles('teacher')
  removeReply(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.reviewsService.reply(user.sub, id, null);
  }

  @Patch('admin/reviews/:id/reply')
  @Roles('admin')
  moderateReply(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ModerateReviewReplyDto) {
    return this.reviewsService.moderateReply(user.sub, id, dto);
  }
}