import { Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { SupabaseService } from '../database/supabase.service.js';
import { ClaimAccessPaymentDto, ListAccessPaymentsDto, ReviewAccessPaymentDto } from './access.dto.js';

@Injectable()
export class AccessRepository {
  constructor(private readonly supabase: SupabaseService) {}
  async summary(userId: string) {
    const { data, error } = await this.supabase.client.rpc('teacher_access_summary', { p_user_id: userId });
    if (error) throwSupabaseError(error, 'לא ניתן לטעון את מצב הגישה');
    return data;
  }
  async claim(userId: string, dto: ClaimAccessPaymentDto) {
    const { data, error } = await this.supabase.client.rpc('claim_teacher_access_payment', { p_user_id: userId, p_reference: dto.reference, p_terms: dto.acceptTerms });
    if (error) throwSupabaseError(error, 'לא ניתן לשמור את דיווח התשלום');
    return data;
  }
  async review(actorId: string, id: string, dto: ReviewAccessPaymentDto) {
    const { data, error } = await this.supabase.client.rpc('review_teacher_access_payment', { p_actor_id: actorId, p_payment_id: id, p_approve: dto.approve, p_note: dto.note });
    if (error) throwSupabaseError(error, 'לא ניתן לשמור את החלטת התשלום');
    return data;
  }
  async list(query: ListAccessPaymentsDto) {
    const offset = (query.page - 1) * query.limit;
    let request = this.supabase.client.from('teacher_access_payments').select('*').order(query.view === 'history' ? 'reviewed_at' : 'created_at', { ascending: false }).order('id').range(offset, offset + query.limit);
    if (query.view === 'history') request = request.not('reviewed_at', 'is', null);
    if (query.teacherId) request = request.eq('teacher_id', query.teacherId);
    if (query.status) request = request.eq('status', query.status);
    if (query.paymentId) request = request.eq('id', query.paymentId);
    const { data, error } = await request;
    if (error) throwSupabaseError(error, 'לא ניתן לטעון דיווחי תשלום');
    const teacherIds = [...new Set(data.slice(0, query.limit).map((row) => row.teacher_id))];
    const teachers = teacherIds.length ? await this.supabase.client.from('teacher_profiles')
      .select('id,slug,profile:profiles!teacher_profiles_user_id_fkey(first_name,last_name,contact_email,phone)').in('id', teacherIds) : { data: [], error: null };
    if (teachers.error) throwSupabaseError(teachers.error, 'לא ניתן לטעון פרטי מורים לבדיקה');
    const reviewerIds = [...new Set(data.slice(0, query.limit).map(payment => payment.reviewed_by).filter(id => id !== null))];
    const reviewers = reviewerIds.length ? await this.supabase.client.from('profiles').select('id,first_name,last_name,contact_email').in('id', reviewerIds) : { data: [], error: null };
    if (reviewers.error) throwSupabaseError(reviewers.error, 'לא ניתן לטעון את פרטי בודקי התשלום');
    return { items: data.slice(0, query.limit).map((payment) => ({ ...payment, teacher: teachers.data?.find((teacher) => teacher.id === payment.teacher_id) ?? null, reviewer: reviewers.data?.find(reviewer => reviewer.id === payment.reviewed_by) ?? null })),
      page: query.page, limit: query.limit, hasMore: data.length > query.limit };
  }

  async inquiry(id: string) {
    const { data, error } = await this.supabase.client.from('inquiries').select(`*,
      student:profiles!inquiries_student_id_fkey(first_name,last_name,contact_email,phone),
      teacher:teacher_profiles!inquiries_teacher_id_fkey(id,slug,headline,profile:profiles!teacher_profiles_user_id_fkey(first_name,last_name,contact_email,phone))`).eq('id', id).single();
    if (error) throwSupabaseError(error, 'הפעילות לא נמצאה');
    return data;
  }
}