import { Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import {
  CreateInquiryDto,
  ListInquiriesDto,
  RespondInquiryDto,
} from './dto/inquiry.dto.js';

export type Inquiry = Database['public']['Tables']['inquiries']['Row'];
export type InquiryListItem = Record<string, unknown> & { id: string };

@Injectable()
export class InquiriesRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async create(userId: string, dto: CreateInquiryDto): Promise<Inquiry> {
    const { data, error } = await this.supabase.client.rpc('create_inquiry', {
      p_student_id: userId,
      p_teacher_id: dto.teacherId,
      p_request_id: (dto.requestId ?? null) as unknown as string,
      p_message: dto.message,
    });
    if (error) throwSupabaseError(error, 'Unable to create inquiry');
    return data[0];
  }

  async findTeacherIdByUserId(userId: string): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('teacher_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Failed to load teacher profile');
    return data?.id ?? null;
  }

  async findAll(
    userId: string,
    teacherId: string | null,
    query: ListInquiriesDto,
    offset: number,
    limit: number,
  ): Promise<InquiryListItem[]> {
    if (query.side === 'teacher' && !teacherId) return [];
    const select =
      query.side === 'student'
        ? `*, teacher:teacher_profiles!inquiries_teacher_id_fkey(
            id, slug, headline, hourly_price, currency, average_rating,
            profile:profiles!teacher_profiles_user_id_fkey(first_name, last_name, avatar_path)
          )`
        : `*, student:profiles!inquiries_student_id_fkey(
            id, first_name, last_name, avatar_path
          )`;
    let request = this.supabase.client
      .from('inquiries')
      .select(select)
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1);
    request =
      query.side === 'student'
        ? request.eq('student_id', userId)
        : request.eq('teacher_id', teacherId!);
    if (query.status) request = request.eq('status', query.status);

    const { data, error } = await request;
    if (error) throwSupabaseError(error, 'Failed to load inquiries');
    return data as unknown as InquiryListItem[];
  }

  async markViewed(inquiryId: string, userId: string): Promise<Inquiry> {
    const { data, error } = await this.supabase.client.rpc(
      'mark_inquiry_viewed',
      { p_inquiry_id: inquiryId, p_teacher_user_id: userId },
    );
    if (error) throwSupabaseError(error, 'Inquiry cannot be viewed');
    return data[0];
  }

  async respond(
    inquiryId: string,
    userId: string,
    dto: RespondInquiryDto,
  ): Promise<Inquiry> {
    const { data, error } = await this.supabase.client.rpc(
      'respond_to_inquiry',
      {
        p_inquiry_id: inquiryId,
        p_teacher_user_id: userId,
        p_status: dto.status,
      },
    );
    if (error) throwSupabaseError(error, 'Inquiry cannot be responded to');
    return data[0];
  }
}