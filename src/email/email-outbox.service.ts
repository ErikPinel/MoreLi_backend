import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailJob } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { EmailService } from './email.service.js';

@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);
  constructor(private readonly supabase: SupabaseService, private readonly email: EmailService, private readonly config: ConfigService) {}

  async process() {
    const { data: jobs, error } = await this.supabase.client.rpc('claim_email_jobs', { p_limit: 10 });
    if (error) throw new Error('Email outbox unavailable; verify migration deployment');
    const results = await Promise.all(jobs.map(async (job) => {
      let success = false;
      try {
        const address = job.audience === 'admin' ? this.config.getOrThrow<string>('email.adminEmail') : job.recipient_email;
        if (address) {
          const message = renderEmail(job, this.config.getOrThrow<string>('publicAppUrl'));
          success = await this.email.deliverJob({ id: job.id, email: address, ...message });
        }
      } catch {
        this.logger.warn(`Email job ${job.id} could not be delivered`);
      }
      const result = await this.supabase.client.rpc('finish_email_job', { p_id: job.id, p_lease: job.lease_token!, p_success: success });
      if (result.error || !result.data) throw new Error('Email delivery acknowledgement failed');
      return success;
    }));
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const purge = await this.supabase.client.from('email_outbox').delete().in('status', ['sent', 'dead']).lt('created_at', cutoff);
    if (purge.error) this.logger.warn('Email retention cleanup failed');
    return { processed: jobs.length, sent: results.filter(Boolean).length, retried: results.filter((success) => !success).length };
  }

  async status() {
    const { data, error } = await this.supabase.client.from('email_outbox')
      .select('id, event_type, status, attempts, created_at, available_at, last_error')
      .neq('status', 'sent').order('created_at').limit(100);
    if (error) throw new Error('Unable to load email delivery status');
    return data;
  }

  async retry(id: string) {
    const { data, error } = await this.supabase.client.from('email_outbox')
      .update({ status: 'pending', attempts: 0, available_at: new Date().toISOString(), last_error: null })
      .eq('id', id).eq('status', 'dead').select('id');
    if (error) throw new Error('Unable to retry email');
    return { retried: data.length === 1 };
  }
}

export function renderEmail(job: EmailJob, baseUrl: string) {
  const payload = job.payload as Record<string, unknown>;
  const value = (key: string) => typeof payload[key] === 'string' ? payload[key] as string : '';
  const admin = job.audience === 'admin';
  let subject = '';
  let text = '';
  let path = admin ? '/admin' : job.audience === 'teacher' ? '/teacher/dashboard' : '/student/profile';
  switch (job.event_type) {
    case 'account.created':
      subject = admin ? 'חשבון חדש במורהלי' : 'ברוכים הבאים למורהלי';
      text = admin ? `נוצר חשבון עבור ${value('name')}.` : 'החשבון שלך נוצר בהצלחה. אפשר להשלים פרטי קשר ולהתחיל לחפש מורה.';
      break;
    case 'teacher.created':
      subject = 'נפתח פרופיל מורה במורהלי';
      text = `${value('name')}, פרופיל ההוראה נפתח כטיוטה. הפרופיל יוצג לתלמידים רק לאחר השלמה ובדיקת מנהל.`;
      path = admin ? '/admin' : '/teacher/onboarding';
      break;
    case 'teacher.pending':
      subject = admin ? 'פרופיל מורה ממתין לבדיקה' : 'פרופיל ההוראה שלך התקבל לבדיקה';
      text = `${value('name')} - ${value('headline')}\nהפרופיל עדיין אינו ציבורי. החלטת הבדיקה תישלח באימייל.`;
      break;
    case 'teacher.published':
      subject = 'פרופיל ההוראה אושר';
      text = `${value('name')}, פרופיל ההוראה אושר ומוצג כעת לתלמידים.`;
      break;
    case 'teacher.rejected':
      subject = 'נדרשים תיקונים בפרופיל ההוראה';
      text = `${value('name')}\n${value('reason')}\nניתן לערוך את הטיוטה ולשלוח שוב לבדיקה.`;
      path = admin ? '/admin' : '/teacher/onboarding';
      break;
    case 'teacher.suspended':
      subject = 'פרופיל ההוראה הושהה';
      text = `${value('name')}, הפרופיל אינו מוצג לתלמידים. לבירור ניתן להשיב להודעה זו.`;
      break;
    case 'inquiry.sent':
    case 'inquiry.accepted':
    case 'inquiry.declined': {
      const accepted = job.event_type === 'inquiry.accepted';
      subject = job.event_type === 'inquiry.sent' ? 'בקשה חדשה לשיעור' : accepted ? 'הבקשה לשיעור התקבלה' : 'הבקשה לשיעור נדחתה';
      text = `${value('studentName')} - ${value('teacherName')}`;
      if (value('start')) {
        const date = new Intl.DateTimeFormat('he-IL', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Jerusalem' });
        text += `\n${date.format(new Date(value('start')))} (שעון ישראל)`;
        if (value('end')) text += `\nסיום: ${date.format(new Date(value('end')))}`;
        text += `\n${value('modeLabel') || (value('mode') === 'in_person' ? 'פרונטלי' : 'אונליין')}`;
      }
      if (accepted) {
        if (job.audience === 'teacher' || admin) text += `\nפרטי תלמיד: ${value('studentEmail')} | ${value('studentPhone')}`;
        if (job.audience === 'student' || admin) text += `\nפרטי מורה: ${value('teacherEmail')} | ${value('teacherPhone')}`;
        text += '\nיש לתאם את פרטי המפגש ישירות. אין חיוב או סליקה באתר.';
      } else if (job.event_type === 'inquiry.sent') {
        text += '\nזו בקשת זמן מועדף, לא הזמנה מאושרת. פרטי הקשר ייחשפו רק לאחר קבלת הבקשה.';
      } else text += '\nהבקשה לא התקבלה. ניתן לפנות למורה אחר.';
      path = admin ? '/admin' : job.audience === 'teacher' ? '/teacher/inquiries' : '/student/inquiries';
      break;
    }
    default: throw new Error('Unsupported marketplace email event');
  }
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  return { subject, text: `${text}\n\n${url}`, html: `<div dir="rtl" lang="he"><h2>${escapeHtml(subject)}</h2><p style="white-space:pre-line">${escapeHtml(text)}</p><p><a href="${escapeHtml(url)}">מעבר לחשבון במורהלי</a></p></div>` };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}