import { Injectable } from '@nestjs/common';
import { Subject, SubjectsRepository } from './subjects.repository.js';

@Injectable()
export class SubjectsService {
  constructor(private readonly subjectsRepository: SubjectsRepository) {}

  findAll(): Promise<Subject[]> {
    return this.subjectsRepository.findAllActive();
  }

  findBySlug(slug: string): Promise<Subject> {
    return this.subjectsRepository.findActiveBySlug(slug);
  }
}