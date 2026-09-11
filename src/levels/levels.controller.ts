import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { Level } from './levels.repository.js';
import { LevelsService } from './levels.service.js';

@Public()
@Controller('levels')
export class LevelsController {
  constructor(private readonly levelsService: LevelsService) {}

  @Get()
  findAll(): Promise<Level[]> {
    return this.levelsService.findAll();
  }
}
