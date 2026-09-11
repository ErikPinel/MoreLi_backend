import { Module } from '@nestjs/common';
import { LevelsController } from './levels.controller.js';
import { LevelsRepository } from './levels.repository.js';
import { LevelsService } from './levels.service.js';

@Module({
  controllers: [LevelsController],
  providers: [LevelsService, LevelsRepository],
})
export class LevelsModule {}
