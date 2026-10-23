import { Injectable } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { Database, Json } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { ReplaceAvailabilityDto } from './dto/availability.dto.js';
import type { BusyLesson } from './lesson-calendar.js';

export type CalendarTeacherContext = { id: string; availability_customized: boolean; profile: { city: { name_he: string; latitude: number | null; longitude: number | null } | null } | null };

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
      'set_teacher_schedule',
      { p_teacher_id: teacherId, p_slots: slots as Json },
    );
    if (error) throwSupabaseError(error, 'Failed to replace availability');
    return data;
  }

  async calendarTeacher(field: 'id' | 'slug', value: string, publishedOnly = true): Promise<CalendarTeacherContext> {
    let request = this.supabase.client.from('teacher_profiles')
      .select('id,availability_customized,profile:profiles!teacher_profiles_user_id_fkey(city:cities(name_he,latitude,longitude))')
      .eq(field, value);
    if (publishedOnly) request = request.eq('profile_status', 'published');
    const { data, error } = await request.single();
    if (error) throwSupabaseError(error, 'פרופיל המורה אינו זמין');
    return data as unknown as CalendarTeacherContext;
  }

  async busyLessons(teacherId: string, excludeLessonId?: string): Promise<BusyLesson[]> {
    const rows: BusyLesson[] = [];
    for (let offset = 0; ; offset += 500) {
      let request = this.supabase.client.from('lessons').select('starts_at,ends_at')
        .eq('teacher_id', teacherId).eq('status', 'scheduled')
        .gte('ends_at', new Date().toISOString()).lte('starts_at', new Date(Date.now() + 92 * 86400000).toISOString())
        .order('starts_at').order('id').range(offset, offset + 499);
      if (excludeLessonId) request = request.neq('id', excludeLessonId);
      const { data, error } = await request;
      if (error) throwSupabaseError(error, 'לא ניתן לבדוק שיעורים שכבר אושרו');
      rows.push(...data.map((row) => ({ requested_start_at: row.starts_at, requested_end_at: row.ends_at })));
      if (data.length < 500) return rows;
    }
  }
}