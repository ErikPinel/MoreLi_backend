import { BadRequestException, Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { SupabaseService } from '../database/supabase.service.js';
import { TeacherProfile, TeacherReviewDetails } from '../teachers/teachers.repository.js';
import {
  CatalogItemDto,
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
          id, first_name, last_name, contact_email, phone, avatar_path, created_at
        ),
        subjects:teacher_subjects(subject:subjects(name_he)),
        levels:teacher_levels(level:levels(name_he))
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
    return Promise.all(data.map(async (teacher) => {
      const path = teacher.profile?.avatar_path;
      const avatar = path ? await this.supabase.client.storage.from('teacher-avatars').createSignedUrl(path, 300) : null;
      return { ...teacher, avatarUrl: avatar?.data?.signedUrl ?? null };
    }));
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

  async findTeacherReview(teacherId: string): Promise<TeacherReviewDetails> {
    const { data, error } = await this.supabase.client
      .from('teacher_profiles')
      .select(`
        *,
        profile:profiles!teacher_profiles_user_id_fkey(
          first_name, last_name, contact_email, phone
        )
      `)
      .eq('id', teacherId)
      .single();
    if (error) throwSupabaseError(error, 'Failed to load teacher review');
    return data as unknown as TeacherReviewDetails;
  }

  async approvePendingTeacher(teacherId: string, actorId: string): Promise<TeacherProfile> {
    const { data, error } = await this.supabase.client.rpc(
      'approve_teacher_review_by_admin',
      { p_teacher_id: teacherId, p_actor_id: actorId },
    );
    if (error) throwSupabaseError(error, 'Failed to approve teacher');
    return data[0];
  }

  async rejectPendingTeacher(teacherId: string, actorId: string, reason: string) {
    const { data, error } = await this.supabase.client.rpc('reject_teacher_review', {
      p_teacher_id: teacherId, p_actor_id: actorId, p_reason: reason,
    });
    if (error) throwSupabaseError(error, 'Unable to reject tutor review');
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

  async replaceProfessions(professions: CatalogItemDto[]) {
    const { error } = await this.supabase.client.from('subjects').upsert(
      professions.map((item, index) => ({
        name_he: item.name_he,
        name_en: item.name_he,
        slug: item.slug,
        sort_order: (index + 1) * 10,
        is_active: true,
      })),
      { onConflict: 'slug' },
    );
    if (error) throwSupabaseError(error, 'Failed to replace professions');
    return { updated_count: professions.length };
  }

  async replaceCities(cities: CatalogItemDto[]) {
    const { error } = await this.supabase.client.from('cities').upsert(
      cities.map((item) => ({
        name_he: item.name_he,
        name_en: item.name_he,
        slug: item.slug,
        is_active: true,
      })),
      { onConflict: 'slug' },
    );
    if (error) throwSupabaseError(error, 'Failed to replace cities');
    return { updated_count: cities.length };
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