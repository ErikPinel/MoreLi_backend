import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller.js';
import { RequestsRepository } from './requests.repository.js';
import { RequestsService } from './requests.service.js';

@Module({
	controllers: [RequestsController],
	providers: [RequestsService, RequestsRepository],
	exports: [RequestsService, RequestsRepository],
})
export class RequestsModule {}
