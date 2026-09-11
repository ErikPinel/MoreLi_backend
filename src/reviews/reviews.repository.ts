import { Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { CreateReviewDto } from './dto/review.dto.js';

export type Review = Database['public']['Tables']['reviews']['Row'];
export type PublicReview = Pick<Review, 'id' | 'rating' | 'body' | 'created_at'>;

@Injectable()
export class ReviewsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async create(userId: string, dto: CreateReviewDto): Promise<Review> {
    const { data, error } = await this.supabase.client.rpc(
      'submit_verified_review',
      {
        p_student_id: userId,
        p_inquiry_id: dto.inquiryId,
        p_rating: dto.rating,
        p_body: dto.body ?? '',
      },
    );
    if (error) throwSupabaseError(error, 'Review is not eligible');
    return data[0];
  }

  async findPublishedByTeacher(
    teacherId: string,
    offset: number,
    limit: number,
  ): Promise<PublicReview[]> {
    const { data, error } = await this.supabase.client
      .from('reviews')
      .select('id, rating, body, created_at')
      .eq('teacher_id', teacherId)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1);
    if (error) throwSupabaseError(error, 'Failed to load reviews');
    return data;
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