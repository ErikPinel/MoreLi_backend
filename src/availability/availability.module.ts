import { Module } from '@nestjs/common';
import { TeachersModule } from '../teachers/teachers.module.js';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityRepository } from './availability.repository.js';
import { AvailabilityService } from './availability.service.js';

@Module({
	imports: [TeachersModule],
	controllers: [AvailabilityController],
	providers: [AvailabilityService, AvailabilityRepository],
})
export class AvailabilityModule {}
