import { Injectable } from '@nestjs/common';
import {
  CreateInquiryDto,
  ListInquiriesDto,
  RespondInquiryDto,
} from './dto/inquiry.dto.js';
import { InquiriesRepository, Inquiry } from './inquiries.repository.js';

@Injectable()
export class InquiriesService {
  constructor(private readonly inquiriesRepository: InquiriesRepository) {}

  create(userId: string, dto: CreateInquiryDto): Promise<Inquiry> {
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

  respond(
    userId: string,
    inquiryId: string,
    dto: RespondInquiryDto,
  ): Promise<Inquiry> {
    return this.inquiriesRepository.respond(inquiryId, userId, dto);
  }
}