import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { resolveCatalogId } from '../common/database/catalog-slug.js';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';

export type StudentRequest =
  Database['public']['Tables']['student_requests']['Row'];

@Injectable()
export class RequestsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async resolveSlugs(dto: CreateRequestDto) {
    const [subjectId, cityId] = await Promise.all([
      resolveCatalogId(this.supabase.client, 'subjects', dto.subjectSlug, dto.subjectId),
      resolveCatalogId(this.supabase.client, 'cities', dto.citySlug, dto.cityId),
    ]);
    if (subjectId === undefined) throw new BadRequestException('A subject is required');
    return { ...dto, subjectId, cityId };
  }

  async create(userId: string, dto: CreateRequestDto): Promise<StudentRequest> {
    const resolved = await this.resolveSlugs(dto);
    const { data, error } = await this.supabase.client
      .from('student_requests')
      .insert({
        student_id: userId,
        subject_id: resolved.subjectId,
        level_id: dto.levelId ?? null,
        city_id: resolved.cityId ?? null,
        online_ok: dto.onlineOk,
        in_person_ok: dto.inPersonOk,
        budget_min: dto.budgetMin ?? null,
        budget_max: dto.budgetMax ?? null,
        desired_start_at: dto.desiredAt ?? null,
        goal: dto.goal.trim(),
        notes: dto.notes?.trim() || null,
        status: 'open',
      })
      .select()
      .single();
    if (error) throwSupabaseError(error, 'Failed to create request');
    return data;
  }

  async updateOwned(
    userId: string,
    requestId: string,
    dto: CreateRequestDto,
  ): Promise<StudentRequest> {
    const resolved = await this.resolveSlugs(dto);
    const { data, error } = await this.supabase.client
      .from('student_requests')
      .update({
        subject_id: resolved.subjectId,
        level_id: dto.levelId ?? null,
        city_id: resolved.cityId ?? null,
        online_ok: dto.onlineOk,
        in_person_ok: dto.inPersonOk,
        budget_min: dto.budgetMin ?? null,
        budget_max: dto.budgetMax ?? null,
        desired_start_at: dto.desiredAt ?? null,
        goal: dto.goal.trim(),
        notes: dto.notes?.trim() || null,
      })
      .eq('id', requestId)
      .eq('student_id', userId)
      .eq('status', 'open')
      .select()
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Failed to update request');
    if (!data) throw new NotFoundException('Open request not found');
    return data;
  }

  async findOwned(
    userId: string,
    requestId: string,
  ): Promise<StudentRequest> {
    const { data, error } = await this.supabase.client
      .from('student_requests')
      .select('*')
      .eq('id', requestId)
      .eq('student_id', userId)
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Failed to load request');
    if (!data) throw new NotFoundException('Request not found');
    return data;
  }

  async findAllOwned(
    userId: string,
    offset: number,
    limit: number,
  ): Promise<StudentRequest[]> {
    const { data, error } = await this.supabase.client
      .from('student_requests')
      .select('*')
      .eq('student_id', userId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1);
    if (error) throwSupabaseError(error, 'Failed to load requests');
    return data;
  }

  async closeOwned(userId: string, requestId: string): Promise<StudentRequest> {
    const { data, error } = await this.supabase.client
      .from('student_requests')
      .update({ status: 'closed' })
      .eq('id', requestId)
      .eq('student_id', userId)
      .in('status', ['open', 'matched'])
      .select()
      .maybeSingle();
    if (error) throwSupabaseError(error, 'Failed to close request');
    if (!data) throw new NotFoundException('Open request not found');
    return data;
  }
}