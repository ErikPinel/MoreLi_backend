import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { EmailJob, Json } from '../database/database.types.js';
import { SupabaseService } from '../database/supabase.service.js';
import { EmailDeliveryResult, EmailService, EmailSnapshot } from './email.service.js';

@Injectable()
export class EmailOutboxService {
  private readonly logger = new Logger(EmailOutboxService.name);
  constructor(private readonly supabase: SupabaseService, private readonly email: EmailService, private readonly config: ConfigService) {}

  async process() {
    if (!this.email.isConfigured()) throw new ServiceUnavailableException('Resend sender is not configured; emails remain queued');
    if (this.email.isTestSender()) throw new ServiceUnavailableException('Resend test sender is configured; transactional emails remain queued until a verified sender is set');
    const { data: jobs, error } = await this.supabase.client.rpc('claim_email_jobs', { p_limit: 10 });
    if (error) throw new Error('Email outbox unavailable; verify migration deployment');
    const results: EmailDeliveryResult[] = [];
    for (const [index, job] of jobs.entries()) {
      if (index > 0) await delay(600);
      let delivery: EmailDeliveryResult = { accepted: false, retryable: true, errorCode: 'preparation_failed' };
      try {
        const address = job.audience === 'admin' ? this.config.getOrThrow<string>('email.adminEmail') : job.recipient_email;
        if (address) {
          const message = renderEmail(job, this.config.getOrThrow<string>('publicAppUrl'));
          const candidate = this.email.prepareJob({ id: job.id, email: address, ...message });
          const prepared = await this.supabase.client.rpc('prepare_email_job', { p_id: job.id, p_lease: job.lease_token!, p_message: candidate as unknown as Json });
          if (prepared.error) throw new Error('Unable to freeze delivery payload');
          const snapshot = prepared.data as unknown as EmailSnapshot;
          const recipientHash = createHash('sha256').update(snapshot.to[0].trim().toLowerCase()).digest('hex');
          const suppressed = await this.supabase.client.from('email_suppressions').select('recipient_hash').eq('recipient_hash', recipientHash).maybeSingle();
          if (suppressed.error) throw new Error('Suppression lookup unavailable');
          delivery = suppressed.data ? { accepted: false, retryable: false, errorCode: 'recipient_suppressed' }
            : await this.email.sendJob({ id: job.id, email: snapshot.to[0], subject: snapshot.subject, text: snapshot.text, html: snapshot.html, snapshot });
        } else delivery = { accepted: false, retryable: false, errorCode: 'recipient_missing' };
      } catch {
        this.logger.warn(`Email job ${job.id} could not be delivered`);
      }
      const result = await this.supabase.client.rpc('finish_resend_job', { p_id: job.id, p_lease: job.lease_token!, p_success: delivery.accepted,
        p_message_id: delivery.messageId ?? null, p_retryable: delivery.retryable, p_error_code: delivery.errorCode ?? null, p_retry_after: delivery.retryAfterSeconds ?? null });
      if (result.error || !result.data) throw new Error('Email delivery acknowledgement failed');
      results.push(delivery);
    }
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const purge = await this.supabase.client.from('email_outbox').delete().in('status', ['sent', 'dead']).lt('created_at', cutoff);
    if (purge.error) this.logger.warn('Email retention cleanup failed');
    return { processed: jobs.length, sent: results.filter((result) => result.accepted).length,
      retried: results.filter((result) => !result.accepted && result.retryable).length, failed: results.filter((result) => !result.accepted && !result.retryable).length };
  }

  async status() {
    const { data, error } = await this.supabase.client.from('email_outbox')
      .select('id, event_type, status, attempts, created_at, available_at, last_error, provider, provider_status, provider_message_id')
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error('Unable to load email delivery status');
    return data;
  }

  configuration() { return { provider: 'resend', configured: this.email.isConfigured(), testMode: this.email.isTestSender(), webhookConfigured: Boolean(this.config.get<string>('email.webhookSecret')) }; }

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
  let actions: { label: string; path: string }[] = [];
  let path = admin ? '/admin' : job.audience === 'teacher' ? '/teacher/dashboard' : '/student/profile';
  switch (job.event_type) {
    case 'account.created':
      subject = admin ? 'חשבון חדש במורהלי' : 'ברוכים הבאים למורהלי';
      text = admin ? `נוצר חשבון עבור ${value('name')}.` : 'החשבון שלך נוצר בהצלחה. אפשר להשלים פרטי קשר ולהתחיל לחפש מורה.';
      break;
    case 'teacher.created':
      subject = 'נפתח פרופיל מורה במורהלי';
      text = `${value('name')}, פרופיל ההוראה נוצר. סטטוס הבדיקה והפעולות להמשך מופיעים באזור המורה. הפרופיל יוצג לתלמידים רק לאחר אישור מנהל.`;
      path = admin ? '/admin' : '/teacher/onboarding';
      break;
    case 'teacher.pending':
      subject = admin ? 'פרופיל מורה ממתין לבדיקה' : 'פרופיל ההוראה שלך התקבל לבדיקה';
      text = `${value('name')} - ${value('headline')}\nהפרופיל עדיין אינו ציבורי. החלטת הבדיקה תישלח באימייל.`;
      path = admin ? `/admin?teacher=${encodeURIComponent(job.entity_id)}#teachers` : '/teacher/onboarding';
      if (admin) actions = [{ label: 'בדיקה ואישור', path: `${path.replace('#teachers', '')}&decision=approve#teachers` }, { label: 'בדיקה והחזרה לתיקון', path: `${path.replace('#teachers', '')}&decision=reject#teachers` }];
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
      const teacher = job.audience === 'teacher';
      subject = job.event_type === 'inquiry.sent'
        ? admin ? 'פנייה חדשה במורהלי · עדכון למנהל' : teacher ? 'תלמיד מבקש שיעור איתך' : 'הבקשה שלך לשיעור נשלחה'
        : accepted
          ? admin ? 'מורה אישר בקשת שיעור · עדכון למנהל' : teacher ? 'אישרת את בקשת השיעור' : 'המורה אישר את בקשתך לשיעור'
          : admin ? 'מורה דחה בקשת שיעור · עדכון למנהל' : teacher ? 'דחית את בקשת השיעור' : 'המורה לא קיבל את בקשתך לשיעור';
      text = `תלמיד: ${value('studentName')}\nמורה: ${value('teacherName')}`;
      if (value('start')) {
        const date = new Intl.DateTimeFormat('he-IL', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Jerusalem' });
        text += `\n${date.format(new Date(value('start')))} (שעון ישראל)`;
        if (value('end')) text += `\nסיום: ${date.format(new Date(value('end')))}`;
        text += `\n${value('modeLabel') || (value('mode') === 'in_person' ? 'פרונטלי' : 'אונליין')}`;
      }
      if (accepted) {
        if (job.audience === 'teacher' || admin) text += `\nפרטי תלמיד: ${value('studentEmail')} | ${value('studentPhone')}`;
        if (job.audience === 'student' || admin) text += `\nפרטי מורה: ${value('teacherEmail')} | ${value('teacherPhone')}`;
        text += '\nיש לתאם את פרטי המפגש ישירות. אין סליקת כרטיס או חיוב אוטומטי באתר. מועד השיעור ממתין לאישור שהתקיים לאחר הזמן שנבחר.';
      } else if (job.event_type === 'inquiry.sent') {
        text += '\nזו בקשת זמן מועדף, לא הזמנה מאושרת. פרטי הקשר ייחשפו רק לאחר קבלת הבקשה.';
      } else text += '\nהבקשה לא התקבלה. ניתן לפנות למורה אחר.';
      path = admin ? `/admin?inquiry=${encodeURIComponent(job.entity_id)}#activity` : `/${job.audience === 'teacher' ? 'teacher' : 'student'}/inquiries/${encodeURIComponent(job.entity_id)}`;
      break;
    }
    case 'billing.requested':
      subject = admin ? 'דיווח תשלום Bit ממתין לבדיקה' : 'דיווח התשלום התקבל לבדיקה';
      text = `מורה: ${value('teacherName')}\nגישה חודשית לקבלת תלמידים חדשים: ${value('amount') || '60'} ש״ח.\n${admin ? `אסמכתא: ${value('reference')}\nמספר דיווח: ${job.entity_id}\nמועד הדיווח: ${new Date(job.created_at).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })} (שעון ישראל)\nיש לבדוק את קבלת התשלום ב-Bit לפני אישור. דיווח משתמש אינו אישור תשלום.` : 'הגישה תופעל רק לאחר בדיקת קבלת התשלום ואישור מנהל. אין חיוב אוטומטי.'}`;
      path = admin ? `/admin?payment=${encodeURIComponent(job.entity_id)}#payments` : '/teacher/access';
      if (admin) actions = [{ label: 'פתיחת דיווח התשלום · בדיקה, אישור או דחייה', path }];
      break;
    case 'billing.approved':
    case 'billing.rejected':
      subject = job.event_type === 'billing.approved' ? 'הגישה החודשית למורהלי הופעלה' : 'דיווח התשלום לא אושר';
      text = `${value('teacherName')}\n${job.event_type === 'billing.approved' ? `הגישה לקבלת תלמידים חדשים אושרה עד ${value('until') ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'long', timeZone: 'Asia/Jerusalem' }).format(new Date(value('until'))) : 'המועד המופיע בחשבון'}. אין חידוש או חיוב אוטומטי.` : `סיבת ההחלטה: ${value('reason')}\nניתן להשיב להודעה או לפנות לתמיכה.`}`;
      path = admin ? `/admin?payment=${encodeURIComponent(job.entity_id)}#payments` : '/teacher/access';
      break;
    case 'lesson.updated':
      subject = value('status') === 'completed' ? 'שני הצדדים אישרו שהשיעור התקיים' : value('status') === 'cancelled' ? 'עדכון על ביטול שיעור' : value('status') === 'no_show_reported' ? 'דיווח על אי-הגעה לשיעור' : 'נדרש עדכון על השיעור';
      text = `${subject}\n${value('start') ? new Intl.DateTimeFormat('he-IL', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Jerusalem' }).format(new Date(value('start'))) : ''}\n${value('note')}\nדיווח אי-הגעה אינו קביעה מוכחת. במקרה של מחלוקת יש לפנות לתמיכה.`;
      path = admin ? `/admin?inquiry=${encodeURIComponent(job.entity_id)}#activity` : `/${job.audience === 'teacher' ? 'teacher' : 'student'}/inquiries/${encodeURIComponent(job.entity_id)}`;
      break;
    case 'support.created':
    case 'support.updated':
      subject = admin ? `פניית תמיכה: ${value('subject')}` : job.event_type === 'support.created' ? 'הפנייה לתמיכה התקבלה' : 'התקבל מענה לפניית התמיכה';
      text = `${value('subject')}\n${value('name')}\n${value('message')}\nהמשך השיחה והסטטוס נמצאים בעמוד הפנייה.`;
      path = admin ? `/admin?ticket=${encodeURIComponent(job.entity_id)}#support` : `/support/${encodeURIComponent(job.entity_id)}`;
      if (admin) actions = [{ label: 'צפייה ומענה', path }, { label: 'בדיקה וסגירת הפנייה', path: `${path.replace('#support', '')}&decision=resolved#support` }];
      break;
    default: throw new Error('Unsupported marketplace email event');
  }
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  subject = subject.replace(/[\r\n]/g, ' ');
  const buttons = (actions.length ? actions : [{ label: 'צפייה בפרטים ובפעולות', path }]).map((action) => `<a style="display:inline-block;margin:8px 0 8px 12px;padding:12px 18px;border-radius:6px;background:#0c244f;color:white;text-decoration:none" href="${escapeHtml(`${baseUrl.replace(/\/$/, '')}${action.path}`)}">${escapeHtml(action.label)}</a>`).join('');
  return { subject, text: `${text}\n\n${url}`, html: `<div dir="rtl" lang="he"><h2>${escapeHtml(subject)}</h2><p style="line-height:1.7">${escapeHtml(text).replace(/\n/g, '<br />')}</p><p>${buttons}</p>${admin ? '<p style="font-size:12px">הקישור פותח מסך ניהול מאובטח. החלטה מחייבת כניסה ואישור מפורש.</p>' : ''}</div>` };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}