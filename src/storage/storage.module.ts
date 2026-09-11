import { Module } from '@nestjs/common';
import { TeachersModule } from '../teachers/teachers.module.js';
import { StorageController } from './storage.controller.js';
import { StorageService } from './storage.service.js';

@Module({
	imports: [TeachersModule],
	controllers: [StorageController],
	providers: [StorageService],
})
export class StorageModule {}
