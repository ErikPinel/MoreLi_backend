import { Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database, Json } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { AvailabilitySlot } from '../availability/availability.repository.js';
import { MatchScores } from './matching.policy.js';

export type Match = Database['public']['Tables']['matches']['Row'];

@Injectable()
export class MatchingRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findAvailability(teacherIds: string[]): Promise<AvailabilitySlot[]> {
    if (teacherIds.length === 0) return [];
    const { data, error } = await this.supabase.client
      .from('teacher_availability')
      .select('*')
      .in('teacher_id', teacherIds)
      .eq('is_active', true);
    if (error) throwSupabaseError(error, 'Failed to load candidate availability');
    return data;
  }

  async persist(requestId: string, matches: MatchScores[]): Promise<Match[]> {
    const { data, error } = await this.supabase.client.rpc('persist_matches', {
      p_request_id: requestId,
      p_matches: matches as unknown as Json,
    });
    if (error) throwSupabaseError(error, 'Failed to persist matches');
    return data;
  }

  async findForOwnedRequest(userId: string, requestId: string): Promise<Match[]> {
    const { data: request, error: requestError } = await this.supabase.client
      .from('student_requests')
      .select('id')
      .eq('id', requestId)
      .eq('student_id', userId)
      .maybeSingle();
    if (requestError) throwSupabaseError(requestError, 'Failed to load request');
    if (!request) return [];

    const { data, error } = await this.supabase.client
      .from('matches')
      .select('*')
      .eq('request_id', requestId)
      .order('rank');
    if (error) throwSupabaseError(error, 'Failed to load matches');
    return data;
  }
}