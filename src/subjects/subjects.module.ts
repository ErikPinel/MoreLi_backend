import { Module } from '@nestjs/common';
import { SubjectsController } from './subjects.controller.js';
import { SubjectsRepository } from './subjects.repository.js';
import { SubjectsService } from './subjects.service.js';

@Module({
	controllers: [SubjectsController],
	providers: [SubjectsService, SubjectsRepository],
})
export class SubjectsModule {}
