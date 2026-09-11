import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { Subject } from './subjects.repository.js';
import { SubjectsService } from './subjects.service.js';

@Public()
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Get()
  findAll(): Promise<Subject[]> {
    return this.subjectsService.findAll();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string): Promise<Subject> {
    return this.subjectsService.findBySlug(slug);
  }
}