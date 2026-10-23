import { Module } from '@nestjs/common';
import { SupportController } from './support.controller.js';
import { SupportRepository } from './support.repository.js';
@Module({controllers:[SupportController],providers:[SupportRepository]})
export class SupportModule {}