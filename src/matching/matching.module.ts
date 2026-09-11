import { Module } from '@nestjs/common';
import { RequestsModule } from '../requests/requests.module.js';
import { TeachersModule } from '../teachers/teachers.module.js';
import { MatchingController } from './matching.controller.js';
import { MatchingPolicy } from './matching.policy.js';
import { MatchingRepository } from './matching.repository.js';
import { MatchingService } from './matching.service.js';

@Module({
	imports: [RequestsModule, TeachersModule],
	controllers: [MatchingController],
	providers: [MatchingService, MatchingRepository, MatchingPolicy],
})
export class MatchingModule {}
