import { BadRequestException, Injectable } from '@nestjs/common';
import { AvailabilityRepository, CalendarTeacherContext } from './availability.repository.js';
import { buildLessonCalendar } from './lesson-calendar.js';

@Injectable()
export class LessonCalendarService {
  constructor(private readonly repository: AvailabilityRepository) {}
  async findPublic(slug: string, duration = 60, days = 60) {
    return this.forTeacher(await this.repository.calendarTeacher('slug', slug), duration, days);
  }
  async findTeacher(teacherId: string, duration: number, excludeLessonId?: string) {
    return this.forTeacher(await this.repository.calendarTeacher('id', teacherId, false), duration, 90, excludeLessonId);
  }
  async assertRequestedTime(teacherId: string, start: string, end: string) {
    return this.assertTime(await this.repository.calendarTeacher('id', teacherId), start, end);
  }
  async assertTeacherTime(teacherId: string, start: string, end: string, excludeLessonId?: string) {
    return this.assertTime(await this.repository.calendarTeacher('id', teacherId, false), start, end, excludeLessonId);
  }
  private async assertTime(teacher: CalendarTeacherContext, start: string, end: string, excludeLessonId?: string) {
    const duration = (Date.parse(end) - Date.parse(start)) / 60000;
    if (![30,45,60,90,120,180,240].includes(duration)) throw new BadRequestException('משך השיעור אינו נתמך');
    const calendar = await this.forTeacher(teacher, duration, 90, excludeLessonId);
    if (!calendar.days.some((day) => day.times.some((time) => Date.parse(time.startAt) === Date.parse(start) && Date.parse(time.endAt) === Date.parse(end)))) {
      throw new BadRequestException('המועד אינו פנוי בלוח המורה או חל בשבת. בחרו מועד פנוי אחר.');
    }
  }
  private async forTeacher(teacher: CalendarTeacherContext, duration: number, days: number, excludeLessonId?: string) {
    const [slots, busy] = await Promise.all([this.repository.findByTeacherId(teacher.id), this.repository.busyLessons(teacher.id, excludeLessonId)]);
    const city = teacher.profile?.city;
    return buildLessonCalendar({ slots, busy, duration, days, customized: teacher.availability_customized,
      location: city?.latitude != null && city.longitude != null ? { name: city.name_he, latitude: city.latitude, longitude: city.longitude } : null });
  }
}