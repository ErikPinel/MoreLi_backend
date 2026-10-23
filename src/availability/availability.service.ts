import { Injectable, NotFoundException } from '@nestjs/common';
import { TeachersRepository } from '../teachers/teachers.repository.js';
import {
  AvailabilityRepository,
  AvailabilitySlot,
} from './availability.repository.js';
import { ReplaceAvailabilityDto } from './dto/availability.dto.js';
import { isAvailableAt } from './availability-time.js';
import { defaultWeeklyWindows } from './lesson-calendar.js';

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly availabilityRepository: AvailabilityRepository,
    private readonly teachersRepository: TeachersRepository,
  ) {}

  async findPublic(slug: string, at?: string) {
    const teacher = await this.teachersRepository.findPublicBySlug(slug);
    const context = await this.availabilityRepository.calendarTeacher('id', teacher.id);
    const slots = await this.slotsForTeacher(context);
    return this.withAvailabilityCheck(slots, at);
  }

  async findMine(userId: string) {
    const teacher = await this.requireTeacher(userId);
    return this.slotsForTeacher(teacher);
  }

  private slotsForTeacher(teacher: { id: string; availability_customized: boolean }) {
    if (teacher.availability_customized === false) return defaultWeeklyWindows().map((slot, index) => ({ ...slot, id: `default-${index}`, teacher_id: teacher.id, timezone: 'Asia/Jerusalem', created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() }));
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

  private withAvailabilityCheck(slots: Array<Omit<AvailabilitySlot, 'id'> & { id: string | number }>, at?: string) {
    if (!at) return { slots };
    const instant = new Date(at);
    const available = isAvailableAt(slots, instant);
    return { slots, checkedAt: instant.toISOString(), available };
  }
}