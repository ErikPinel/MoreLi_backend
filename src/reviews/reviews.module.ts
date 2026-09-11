import { Module } from '@nestjs/common';
import { TeachersModule } from '../teachers/teachers.module.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsRepository } from './reviews.repository.js';
import { ReviewsService } from './reviews.service.js';

@Module({
	imports: [TeachersModule],
	controllers: [ReviewsController],
	providers: [ReviewsService, ReviewsRepository],
})
export class ReviewsModule {}
