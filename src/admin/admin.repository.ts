import { BadRequestException, Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { SupabaseService } from '../database/supabase.service.js';
import {
  ListAdminReviewsDto,
  ListAdminTeachersDto,
  ModerateReviewDto,
  ModerateTeacherDto,
} from './dto/admin.dto.js';

@Injectable()
export class AdminRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findTeachers(
    query: ListAdminTeachersDto,
    offset: number,
    limit: number,
  ) {
    let request = this.supabase.client
      .from('teacher_profiles')
      .select(`
        *,
        profile:profiles!teacher_profiles_user_id_fkey(
          id, first_name, last_name, phone, avatar_path, created_at
        )
      `)
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1);
    if (query.status) request = request.eq('profile_status', query.status);
    if (query.verification) {
      request = request.eq('verification_status', query.verification);
    }
    const { data, error } = await request;
    if (error) throwSupabaseError(error, 'Failed to load teachers');
    return data;
  }

  async moderateTeacher(teacherId: string, dto: ModerateTeacherDto) {
    if (!dto.profileStatus && !dto.verificationStatus) {
      throw new BadRequestException('At least one moderation change is required');
    }
    const { data, error } = await this.supabase.client.rpc('moderate_teacher', {
      p_teacher_id: teacherId,
      p_profile_status: dto.profileStatus,
      p_verification_status: dto.verificationStatus,
    });
    if (error) throwSupabaseError(error, 'Failed to moderate teacher');
    return data[0];
  }

  async findReviews(
    query: ListAdminReviewsDto,
    offset: number,
    limit: number,
  ) {
    let request = this.supabase.client
      .from('reviews')
      .select(`
        *,
        student:profiles!reviews_student_id_fkey(
          id, first_name, last_name
        ),
        teacher:teacher_profiles!reviews_teacher_id_fkey(
          id, slug, headline
        )
      `)
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1);
    if (query.status) request = request.eq('status', query.status);
    const { data, error } = await request;
    if (error) throwSupabaseError(error, 'Failed to load reviews');
    return data;
  }

  async moderateReview(reviewId: string, dto: ModerateReviewDto) {
    const { data, error } = await this.supabase.client.rpc('moderate_review', {
      p_review_id: reviewId,
      p_status: dto.status,
    });
    if (error) throwSupabaseError(error, 'Failed to moderate review');
    return data[0];
  }
}