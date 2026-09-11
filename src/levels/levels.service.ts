import { Injectable, Logger } from '@nestjs/common';
import { Level, LevelsRepository } from './levels.repository.js';

@Injectable()
export class LevelsService {
  private readonly logger = new Logger(LevelsService.name);

  constructor(private readonly levelsRepository: LevelsRepository) {}

  async findAll(): Promise<Level[]> {
    const levels = await this.levelsRepository.findAllActive();

    this.logger.log(`Fetched levels: ${JSON.stringify(levels)}`);
    return levels;
  }
}
