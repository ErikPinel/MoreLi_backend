import { Injectable, NotFoundException } from '@nestjs/common';
import { TeachersRepository } from '../teachers/teachers.repository.js';
import {
  AvailabilityRepository,
  AvailabilitySlot,
} from './availability.repository.js';
import { ReplaceAvailabilityDto } from './dto/availability.dto.js';
import { isAvailableAt } from './availability-time.js';

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly teachersRepository: TeachersRepository,
  ) {}

  async findPublic(slug: string, at?: string) {
    const teacher = await this.teachersRepository.findPublicBySlug(slug);
    const slots = await this.availabilityRepository.findByTeacherId(teacher.id);
    return this.withAvailabilityCheck(slots, at);
  }

  async findMine(userId: string) {
    const teacher = await this.requireTeacher(userId);
    return this.availabilityRepository.findByTeacherId(teacher.id);
  }

  async replaceMine(userId: string, dto: ReplaceAvailabilityDto) {
    const teacher = await this.requireTeacher(userId);
    return this.availabilityRepository.replace(teacher.id, dto);
  }

  private async requireTeacher(userId: string) {
    const teacher = await this.teachersRepository.findByUserId(userId);
    if (!teacher) throw new NotFoundException('Teacher profile not found');
    return teacher;
  }

  private withAvailabilityCheck(slots: AvailabilitySlot[], at?: string) {
    if (!at) return { slots };
    const instant = new Date(at);
    const available = isAvailableAt(slots, instant);
    return { slots, checkedAt: instant.toISOString(), available };
  }
}