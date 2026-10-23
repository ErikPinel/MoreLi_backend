import { BadRequestException, Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { CreateReviewDto, ListReviewsDto, ModerateReviewReplyDto, UpdateReviewDto } from './dto/review.dto.js';

export type Review = Database['public']['Tables']['reviews']['Row'];
export type PublicReview = Pick<Review, 'id' | 'rating' | 'body' | 'created_at' | 'updated_at' | 'teacher_reply' | 'teacher_reply_at'>;

@Injectable()
export class ReviewsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async create(userId: string, dto: CreateReviewDto): Promise<Review> {
    if (dto.teacherId && dto.inquiryId) throw new BadRequestException('בחרו מורה או פנייה, לא שניהם');
    const request = dto.teacherId
      ? this.supabase.client.rpc('submit_teacher_review', { p_student_id: userId, p_teacher_id: dto.teacherId, p_rating: dto.rating, p_body: dto.body ?? '' })
      : dto.inquiryId ? this.supabase.client.rpc('submit_verified_review', { p_student_id: userId, p_inquiry_id: dto.inquiryId, p_rating: dto.rating, p_body: dto.body ?? '' }) : null;
    if (!request) throw new BadRequestException('יש לבחור מורה לדירוג');
    const { data, error } = await request;
    if (error) throwSupabaseError(error, error.code === '23505' ? 'כבר קיים דירוג שלכם למורה. אפשר לערוך אותו דרך הביקורות שלי.' : 'לא ניתן לפרסם את הדירוג. בחרו מורה מפורסם שאינו אתם ודירוג בין 1 ל־5.');
    return data[0];
  }

  async findPublishedByTeacher(
    teacherId: string,
    offset: number,
    limit: number,
  ): Promise<PublicReview[]> {
    const { data, error } = await this.supabase.client
      .from('reviews')
      .select('*')
      .eq('teacher_id', teacherId)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1);
    if (error) throwSupabaseError(error, 'Failed to load reviews');
    return data.map((review) => ({
      id: review.id, rating: review.rating, body: review.body, created_at: review.created_at, updated_at: review.updated_at,
      teacher_reply: review.teacher_reply_status === 'published' ? review.teacher_reply : null,
      teacher_reply_at: review.teacher_reply_status === 'published' ? review.teacher_reply_at : null,
    }));
  }

  async updateOwned(userId: string, id: string, dto: UpdateReviewDto): Promise<Review> {
    const { data, error } = await this.supabase.client.rpc('edit_owned_review', {
      p_review_id: id, p_student_id: userId, p_rating: dto.rating, p_body: dto.body ?? '',
    });
    if (error) throwSupabaseError(error, 'לא ניתן לעדכן את הביקורת');
    return data[0];
  }

  async deleteOwned(userId: string, id: string) {
    const { error } = await this.supabase.client.rpc('delete_owned_review', { p_review_id: id, p_student_id: userId });
    if (error) throwSupabaseError(error, 'לא ניתן למחוק את הביקורת');
    return { deleted: true };
  }

  async reply(userId: string, id: string, body: string | null): Promise<Review> {
    const { data, error } = await this.supabase.client.rpc('reply_to_review', { p_review_id: id, p_teacher_user_id: userId, p_body: body });
    if (error) throwSupabaseError(error, 'לא ניתן לשמור את התגובה');
    return data[0];
  }

  async moderateReply(userId: string, id: string, dto: ModerateReviewReplyDto): Promise<Review> {
    const { data, error } = await this.supabase.client.rpc('moderate_review_reply', { p_review_id: id, p_actor_id: userId, p_status: dto.status });
    if (error) throwSupabaseError(error, 'לא ניתן לעדכן את מצב התגובה');
    return data[0];
  }

  async findReceived(userId: string, query: ListReviewsDto) {
    const teacher = await this.supabase.client.from('teacher_profiles').select('id').eq('user_id', userId).single();
    if (teacher.error) throwSupabaseError(teacher.error, 'פרופיל המורה לא נמצא');
    const offset = (query.page - 1) * query.limit;
    const { data, error } = await this.supabase.client.from('reviews')
      .select('id, rating, body, created_at, updated_at, teacher_reply, teacher_reply_status, teacher_reply_at')
      .eq('teacher_id', teacher.data.id).eq('status', 'published')
      .order('created_at', { ascending: false }).order('id').range(offset, offset + query.limit);
    if (error) throwSupabaseError(error, 'לא ניתן לטעון את הביקורות');
    return { items: data.slice(0, query.limit), page: query.page, limit: query.limit, hasMore: data.length > query.limit };
  }

  async findOwned(userId: string): Promise<Review[]> {
    const { data, error } = await this.supabase.client
      .from('reviews')
      .select('*')
      .eq('student_id', userId)
      .order('created_at', { ascending: false });
    if (error) throwSupabaseError(error, 'Failed to load reviews');
    return data;
  }
}