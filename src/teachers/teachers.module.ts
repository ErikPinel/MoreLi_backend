import { Module } from '@nestjs/common';
import { TeachersController } from './teachers.controller.js';
import { TeachersRepository } from './teachers.repository.js';
import { TeachersService } from './teachers.service.js';

@Module({
	controllers: [TeachersController],
	providers: [TeachersService, TeachersRepository],
	exports: [TeachersService, TeachersRepository],
})
export class TeachersModule {}
