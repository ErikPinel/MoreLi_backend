import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import {
  CreateInquiryDto,
  ListInquiriesDto,
  RespondInquiryDto,
} from './dto/inquiry.dto.js';
import { InquiriesRepository, Inquiry } from './inquiries.repository.js';

@Injectable()
export class InquiriesService {
  constructor(private readonly inquiriesRepository: InquiriesRepository) {}

  async create(userId: string, dto: CreateInquiryDto): Promise<Inquiry> {
    if (dto.contactSharingConsent !== true)
      throw new BadRequestException('Contact sharing consent is required');
    this.validateSchedule(dto);
    return this.inquiriesRepository.create(userId, dto);
  }

  async findAll(userId: string, query: ListInquiriesDto) {
    const teacherId =
      query.side === 'teacher'
        ? await this.inquiriesRepository.findTeacherIdByUserId(userId)
        : null;
    const items = await this.inquiriesRepository.findAll(
      userId,
      teacherId,
      query,
      (query.page - 1) * query.limit,
      query.limit + 1,
    );
    return {
      items: items.slice(0, query.limit),
      page: query.page,
      limit: query.limit,
      hasMore: items.length > query.limit,
    };
  }

  markViewed(userId: string, inquiryId: string): Promise<Inquiry> {
    return this.inquiriesRepository.markViewed(inquiryId, userId);
  }

  async respond(
    userId: string,
    inquiryId: string,
    dto: RespondInquiryDto,
  ): Promise<Inquiry> {
    return this.inquiriesRepository.respond(inquiryId, userId, dto);
  }

  private validateSchedule(dto: CreateInquiryDto): void {
    if (!dto.requestedStartAt && !dto.requestedEndAt && !dto.lessonMode) return;
    if (!dto.requestedStartAt || !dto.requestedEndAt || !dto.lessonMode) {
      throw new BadRequestException(
        'Lesson time and mode must be provided together',
      );
    }
    const start = new Date(dto.requestedStartAt);
    const end = new Date(dto.requestedEndAt);
    if (start <= new Date() || end <= start) {
      throw new BadRequestException(
        'Requested lesson time must be in the future',
      );
    }
    if (end.getTime() - start.getTime() > 4 * 60 * 60 * 1000) {
      throw new BadRequestException('Lesson request cannot exceed four hours');
    }
  }
}
