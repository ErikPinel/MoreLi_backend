import { Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database, Json } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { ReplaceAvailabilityDto } from './dto/availability.dto.js';

export type AvailabilitySlot =
  Database['public']['Tables']['teacher_availability']['Row'];

@Injectable()
export class AvailabilityRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async findByTeacherId(teacherId: string): Promise<AvailabilitySlot[]> {
    const { data, error } = await this.supabase.client
      .from('teacher_availability')
      .select('*')
      .eq('teacher_id', teacherId)
      .eq('is_active', true)
      .order('day_of_week')
      .order('start_time');
    if (error) throwSupabaseError(error, 'Failed to load availability');
    return data;
  }

  async replace(teacherId: string, dto: ReplaceAvailabilityDto) {
    const slots = dto.slots.map((slot) => ({
      day_of_week: slot.dayOfWeek,
      start_time: slot.startTime,
      end_time: slot.endTime,
      timezone: slot.timezone ?? 'Asia/Jerusalem',
      is_active: slot.isActive ?? true,
    }));
    const { data, error } = await this.supabase.client.rpc(
      'replace_teacher_availability',
      { p_teacher_id: teacherId, p_slots: slots as Json },
    );
    if (error) throwSupabaseError(error, 'Failed to replace availability');
    return data;
  }
}