import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { throwSupabaseError } from '../common/database/supabase-error.js';
import { SupabaseService } from '../database/supabase.service.js';
import { LessonActionDto } from '../inquiries/dto/inquiry.dto.js';
import { ListLessonsDto, SaveLessonDto } from './lesson.dto.js';

const lessonSelect = `*,student:profiles!lessons_student_id_fkey(id,first_name,last_name,phone,contact_email),
  teacher:teacher_profiles!lessons_teacher_id_fkey(id,user_id,slug,headline,
  profile:profiles!teacher_profiles_user_id_fkey(first_name,last_name,phone,contact_email))`;

function lessonError(error: { code?: string; message: string }): never {
  const messages: Record<string, string> = {
    LESSON_CONFLICT: 'למורה או לתלמיד כבר נקבע שיעור בשעה הזאת. בחרו מועד אחר.',
    LESSON_OUTSIDE_AVAILABILITY: 'המועד מחוץ לשעות הזמינות. עדכנו את הזמינות או בחרו שעה אחרת.',
    LESSON_INVALID_TIME: 'בחרו מועד עתידי ומשך שיעור תקין.',
    LESSON_CONNECTION_REQUIRED: 'ניתן לקבוע שיעור רק לתלמיד שהפנייה שלו התקבלה.',
    LESSON_CANNOT_RESCHEDULE: 'לא ניתן להזיז שיעור שכבר התחיל, נסגר או אושר. אפשר לפתוח שיעור חדש.',
    LESSON_COMPLETION_NOT_ALLOWED: 'אפשר לאשר קיום או לדווח על אי-הגעה רק לאחר סיום שיעור שנקבע.',
    LESSON_REASON_REQUIRED: 'יש לכתוב סיבה באורך 5–1,000 תווים.',
    LESSON_ALREADY_CLOSED: 'השיעור כבר נסגר ולא ניתן לשנות את ההחלטה כאן.',
    LESSON_REQUEST_KEY_REUSED: 'הפעולה כבר נשמרה עם פרטים אחרים. רעננו את הדף לפני ניסיון נוסף.',
  };
  throwSupabaseError(error, messages[error.message] ?? 'לא ניתן לשמור את השיעור. רעננו את הנתונים ונסו שוב.');
}

@Injectable()
export class LessonsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async teacherId(userId: string) {
    const { data, error } = await this.supabase.client.from('teacher_profiles').select('id').eq('user_id', userId).maybeSingle();
    if (error) throwSupabaseError(error, 'לא ניתן לטעון את פרטי המורה');
    if (!data) throw new ForbiddenException('נדרש פרופיל מורה');
    return data.id;
  }

  async list(userId: string, query: ListLessonsDto) {
    if (query.studentId && query.side !== 'teacher') throw new BadRequestException('סינון לפי תלמיד זמין רק במצב מורה');
    if (query.view === 'week' && (!query.from || !query.to)) throw new BadRequestException('יש לבחור תחילת שבוע וסופו');
    if (query.from && query.to && (Date.parse(query.to) <= Date.parse(query.from) || Date.parse(query.to) - Date.parse(query.from) > 32 * 86400000)) {
      throw new BadRequestException('טווח התאריכים חייב להיות חיובי ועד 32 ימים');
    }
    const teacherId = query.side === 'teacher' ? await this.teacherId(userId) : null;
    let request = this.supabase.client.from('lessons').select(lessonSelect, { count: 'exact' });
    request = teacherId ? request.eq('teacher_id', teacherId) : request.eq('student_id', userId);
    if (query.studentId) request = request.eq('student_id', query.studentId);
    const now = new Date().toISOString();
    if (query.view === 'upcoming') request = request.eq('status', 'scheduled').gt('ends_at', now);
    if (query.view === 'past') request = request.or(`ends_at.lte.${now},status.in.(completed,cancelled,no_show_reported)`);
    if (query.view === 'completed') request = request.eq('status', 'completed');
    if (query.view === 'needs_action') {
      const confirmation = query.side === 'teacher' ? 'teacher_completed_at' : 'student_completed_at';
      request = request.or(`status.eq.needs_scheduling,and(status.eq.scheduled,ends_at.lte.${now},${confirmation}.is.null)`);
    }
    if (query.from) request = request.gt('ends_at', query.from);
    if (query.to) request = request.lt('starts_at', query.to);
    const offset = (query.page - 1) * query.limit;
    const { data, error, count } = await request.order('starts_at', { ascending: query.view !== 'past', nullsFirst: query.view === 'needs_action' })
      .order('id').range(offset, offset + query.limit - 1);
    if (error) throwSupabaseError(error, 'לא ניתן לטעון את השיעורים');
    if (count === null) throw new InternalServerErrorException('לא ניתן לטעון את ספירת השיעורים. נסו שוב.');
    return { items: data, total: count, page: query.page, limit: query.limit, hasMore: offset + data.length < count };
  }

  async detail(userId: string, id: string, admin = false) {
    let request = this.supabase.client.from('lessons').select(lessonSelect).eq('id', id);
    if (!admin) {
      const teacher = await this.supabase.client.from('teacher_profiles').select('id').eq('user_id', userId).maybeSingle();
      if (teacher.error) throwSupabaseError(teacher.error, 'לא ניתן לבדוק הרשאה לשיעור');
      request = teacher.data ? request.or(`student_id.eq.${userId},teacher_id.eq.${teacher.data.id}`) : request.eq('student_id', userId);
    }
    const { data, error } = await request.maybeSingle();
    if (error) throwSupabaseError(error, 'לא ניתן לטעון את השיעור');
    if (!data) throw new NotFoundException('השיעור לא נמצא');
    return data;
  }

  async student(userId: string, studentId: string) {
    const teacherId = await this.teacherId(userId);
    const { data, error } = await this.supabase.client.from('inquiries')
      .select('student:profiles!inquiries_student_id_fkey(id,first_name,last_name,phone,contact_email)')
      .eq('teacher_id', teacherId).eq('student_id', studentId).eq('status', 'accepted').limit(1).maybeSingle();
    if (error) throwSupabaseError(error, 'לא ניתן לטעון את פרטי התלמיד');
    if (!data?.student) throw new NotFoundException('לא נמצא תלמיד שהפנייה שלו התקבלה');
    return data.student;
  }

  async save(userId: string, dto: SaveLessonDto, id?: string) {
    const { data, error } = await this.supabase.client.rpc('save_teacher_lesson', {
      p_actor: userId, p_request_key: dto.requestKey, p_student: dto.studentId,
      p_start: dto.startsAt, p_end: dto.endsAt, p_mode: dto.mode, p_lesson_id: id ?? null,
    });
    if (error) lessonError(error);
    return data[0];
  }

  async savedRequest(teacherId: string, requestKey: string) {
    const { data, error } = await this.supabase.client.from('lessons').select('id').eq('teacher_id', teacherId).eq('request_key', requestKey).maybeSingle();
    if (error) throwSupabaseError(error, 'לא ניתן לבדוק אם השיעור כבר נשמר');
    return data;
  }

  async updateState(userId: string, id: string, dto: LessonActionDto) {
    const { data, error } = await this.supabase.client.rpc('update_scheduled_lesson_state', {
      p_user_id: userId, p_lesson_id: id, p_action: dto.action, p_note: dto.note ?? '',
    });
    if (error) lessonError(error);
    return data[0];
  }
}
