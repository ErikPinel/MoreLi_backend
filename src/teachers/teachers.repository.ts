import { resolveCatalogId } from '../common/database/catalog-slug.js';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database, Json } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import {
  ReplaceTeacherLevelsDto,
  ReplaceTeacherServiceAreasDto,
  ReplaceTeacherSubjectsDto,
} from './dto/replace-teacher-collections.dto.js';
import { SearchTeachersDto } from './dto/search-teachers.dto.js';
import { UpdateTeacherDto } from './dto/update-teacher.dto.js';
import { SubmitOnboardingDto } from './dto/submit-onboarding.dto.js';

const PUBLIC_TEACHER_SELECT = `
  id, slug, headline, bio, hourly_price, currency, years_experience,
  teaches_online, teaches_in_person, verification_status, average_rating,
  review_count, response_rate, response_time_minutes, is_founder, published_at,
  profile:profiles!teacher_profiles_user_id_fkey(first_name, last_name, avatar_path),
  subjects:teacher_subjects(subject_id, experience_years, description, subject:subjects(id, name_he, name_en, slug)),
  levels:teacher_levels(level_id, level:levels(id, name_he, name_en, slug)),
  service_areas:teacher_service_areas(city_id, city:cities(id, name_he, name_en, slug))
`;

export type TeacherProfile =
  Database['public']['Tables']['teacher_profiles']['Row'];
export type PublicTeacher = Record<string, unknown> & { id: string; slug: string };
export type TeacherOnboarding = Record<string, unknown> & {
  id: string;
  user_id: string;
};
export type TeacherReviewDetails = TeacherProfile & {
  profile: {
    first_name: string;
    last_name: string;
    contact_email: string | null;
    phone: string | null;
  };
};

@Injectable()
export class TeachersRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async resolveSearchSlugs(query: SearchTeachersDto): Promise<SearchTeachersDto> {
    const [subjectId, cityId] = await Promise.all([
      resolveCatalogId(this.supabase.client, 'subjects', query.subjectSlug, query.subjectId),
      resolveCatalogId(this.supabase.client, 'cities', query.citySlug, query.cityId),
    ]);
    return { ...query, subjectId, cityId };
  }

  async searchCandidates(
    query: SearchTeachersDto,
    limit: number,
    offset: number,
  ): Promise<Database['public']['Functions']['search_teacher_candidates_v2']['Returns']> {
    const { data, error } = await this.supabase.client.rpc(
      'search_teacher_candidates_v2',
      {
        p_subject_id: query.subjectId,
        p_level_id: query.levelId,
        p_city_id: query.cityId,
        p_online_ok: query.onlineOk,
        p_in_person_ok: query.inPersonOk,
        p_budget_min: query.budgetMin,
        p_budget_max: query.budgetMax,
        p_verified_only: query.verifiedOnly,
        p_rating_min: query.ratingMin,
        p_sort: query.sort,
        p_limit: limit,
        p_offset: offset,
      },
    );

    if (error) throwSupabaseError(error, 'Failed to search teachers');
    return data;
  }

  async countCandidates(query: SearchTeachersDto): Promise<number> {
    const { data, error } = await this.supabase.client.rpc(
      'count_teacher_candidates_v2',
      {
        p_subject_id: query.subjectId,
        p_level_id: query.levelId,
        p_city_id: query.cityId,
        p_online_ok: query.onlineOk,
        p_in_person_ok: query.inPersonOk,
        p_budget_min: query.budgetMin,
        p_budget_max: query.budgetMax,
        p_verified_only: query.verifiedOnly,
        p_rating_min: query.ratingMin,
      },
    );
    if (error) throwSupabaseError(error, 'Failed to count teachers');
    return Number(data);
  }

  async findPublicByIds(ids: string[]): Promise<PublicTeacher[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.supabase.client
      .from('teacher_profiles')
      .select(PUBLIC_TEACHER_SELECT)
      .in('id', ids)
      .eq('profile_status', 'published');

    if (error) throwSupabaseError(error, 'Failed to load teachers');
    return data as unknown as PublicTeacher[];
  }

  async findPublicBySlug(slug: string): Promise<PublicTeacher> {
    const { data, error } = await this.supabase.client
      .from('teacher_profiles')
      .select(PUBLIC_TEACHER_SELECT)
      .eq('slug', slug)
      .eq('profile_status', 'published')
      .maybeSingle();

    if (error) throwSupabaseError(error, 'Failed to load teacher');
    if (!data) throw new NotFoundException('Teacher not found');
    return data as unknown as PublicTeacher;
  }

  async findByUserId(userId: string): Promise<TeacherProfile | null> {
    const { data, error } = await this.supabase.client
      .from('teacher_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throwSupabaseError(error, 'Failed to load teacher profile');
    return data;
  }

  async findOnboardingByUserId(userId: string): Promise<TeacherOnboarding | null> {
    const { data, error } = await this.supabase.client
      .from('teacher_profiles')
      .select(`
        *,
        profile:profiles!teacher_profiles_user_id_fkey(
          first_name, last_name, phone, contact_email, avatar_path, role, city_id
        ),
        subjects:teacher_subjects(subject_id, experience_years, description),
        levels:teacher_levels(level_id),
        service_areas:teacher_service_areas(city_id),
        availability:teacher_availability(
          id, day_of_week, start_time, end_time, timezone, is_active
        )
      `)
      .eq('user_id', userId)
      .order('subject_id', {
        referencedTable: 'teacher_subjects',
      })
      .order('level_id', { referencedTable: 'teacher_levels' })
      .order('city_id', { referencedTable: 'teacher_service_areas' })
      .order('day_of_week', { referencedTable: 'teacher_availability' })
      .order('start_time', { referencedTable: 'teacher_availability' })
      .maybeSingle();

    if (error) throwSupabaseError(error, 'Failed to load teacher onboarding');
    return data as unknown as TeacherOnboarding | null;
  }

  async createDraft(
    userId: string,
    slug: string,
    acceptTerms: boolean,
  ): Promise<TeacherProfile> {
    const { data, error } = await this.supabase.client.rpc(
      'create_teacher_draft',
      {
        p_user_id: userId,
        p_slug: slug,
        p_terms_accepted: acceptTerms,
      },
    );
    if (error) throwSupabaseError(error, 'Failed to create teacher profile');
    return data[0];
  }

  async submitForReview(
    teacherId: string,
    userId: string,
  ): Promise<TeacherProfile> {
    const { data, error } = await this.supabase.client.rpc(
      'submit_teacher_for_review',
      { p_teacher_id: teacherId, p_user_id: userId },
    );
    if (error) throwSupabaseError(error, 'Failed to submit teacher for review');
    return data[0];
  }

  async submitOnboarding(userId: string, dto: SubmitOnboardingDto): Promise<TeacherProfile> {
    const { data, error } = await this.supabase.client.rpc('submit_teacher_onboarding', {
      p_user_id: userId,
      p_form: JSON.parse(JSON.stringify(dto)) as Json,
    });
    if (error) throwSupabaseError(error, 'לא הצלחנו לשלוח את הפרופיל. החשבון לא שונה; בדקו את הפרטים ונסו שוב.');
    return data[0];
  }

  async findReviewDetails(teacherId: string): Promise<TeacherReviewDetails> {
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
    if (error) throwSupabaseError(error, 'Failed to load teacher review details');
    return data as unknown as TeacherReviewDetails;
  }

  async updateOwned(
    teacherId: string,
    userId: string,
    dto: UpdateTeacherDto,
  ): Promise<TeacherProfile> {
    const updates: Database['public']['Tables']['teacher_profiles']['Update'] = {};
    if (dto.headline !== undefined) updates.headline = dto.headline.trim();
    if (dto.bio !== undefined) updates.bio = dto.bio.trim();
    if (dto.hourlyPrice !== undefined) updates.hourly_price = dto.hourlyPrice;
    if (dto.currency !== undefined) updates.currency = dto.currency.toUpperCase();
    if (dto.yearsExperience !== undefined) {
      updates.years_experience = dto.yearsExperience;
    }
    if (dto.teachesOnline !== undefined) {
      updates.teaches_online = dto.teachesOnline;
    }
    if (dto.teachesInPerson !== undefined) {
      updates.teaches_in_person = dto.teachesInPerson;
    }

    const { data, error } = await this.supabase.client
      .from('teacher_profiles')
      .update(updates)
      .eq('id', teacherId)
      .eq('user_id', userId)
      .select()
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Failed to update teacher profile');
    if (!data) throw new NotFoundException('Teacher profile not found');
    return data;
  }

  async replaceSubjects(teacherId: string, dto: ReplaceTeacherSubjectsDto) {
    const subjects = await Promise.all(dto.subjects.map(async (subject) => ({
      subject_id: await resolveCatalogId(this.supabase.client, 'subjects', subject.subjectSlug, subject.subjectId),
      experience_years: subject.experienceYears ?? null,
      description: subject.description?.trim() || null,
    })));
    const { data, error } = await this.supabase.client.rpc(
      'replace_teacher_subjects',
      { p_teacher_id: teacherId, p_subjects: subjects as Json },
    );
    if (error) throwSupabaseError(error, 'Failed to replace teacher subjects');
    return data;
  }

  async replaceLevels(teacherId: string, dto: ReplaceTeacherLevelsDto) {
    const { data, error } = await this.supabase.client.rpc(
      'replace_teacher_levels',
      { p_teacher_id: teacherId, p_level_ids: dto.levelIds },
    );
    if (error) throwSupabaseError(error, 'Failed to replace teacher levels');
    return data;
  }

  async replaceServiceAreas(
    teacherId: string,
    dto: ReplaceTeacherServiceAreasDto,
  ) {
    if (dto.cityIds !== undefined && dto.citySlugs !== undefined) {
      throw new BadRequestException('Provide citySlugs or cityIds, not both');
    }
    const cityIds = dto.citySlugs === undefined ? dto.cityIds : await Promise.all(
      dto.citySlugs.map((slug) => resolveCatalogId(this.supabase.client, 'cities', slug)),
    );
    const { data, error } = await this.supabase.client.rpc(
      'replace_teacher_service_areas',
      { p_teacher_id: teacherId, p_city_ids: cityIds as number[] },
    );
    if (error) throwSupabaseError(error, 'Failed to replace service areas');
    return data;
  }

}