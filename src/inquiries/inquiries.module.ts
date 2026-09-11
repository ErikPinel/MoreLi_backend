import { Module } from '@nestjs/common';
import { InquiriesController } from './inquiries.controller.js';
import { InquiriesRepository } from './inquiries.repository.js';
import { InquiriesService } from './inquiries.service.js';

@Module({
	controllers: [InquiriesController],
	providers: [InquiriesService, InquiriesRepository],
})
export class InquiriesModule {}
