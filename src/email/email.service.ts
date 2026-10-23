import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export type EmailDeliveryResult = {
  accepted: boolean;
  messageId?: string;
  retryable: boolean;
  errorCode?: string;
  retryAfterSeconds?: number;
};

export type EmailSnapshot = { from: string; to: string[]; replyTo: string; subject: string; text: string; html: string; tags: { name: string; value: string }[] };

type Contact = {
  email: string | null;
  name: string;
  phone?: string | null;
};

type LessonDetails = {
  teacher: Contact;
  student: Contact;
  requestedStartAt?: string | null;
  requestedEndAt?: string | null;
  lessonMode?: string | null;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client?: Resend;
  private readonly senderEmail?: string;
  private readonly senderName: string;
  private readonly adminEmail: string;
  private readonly testRecipientEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = configService.get<string>('email.resendApiKey');
    this.senderEmail = configService.get<string>('email.senderEmail') || undefined;
    this.senderName = configService.get<string>('email.senderName') ?? 'MoreLi';
    this.adminEmail = configService.get<string>('email.adminEmail') ?? 'erik.zusin@gmail.com';
    this.testRecipientEmail = configService.get<string>('email.testRecipientEmail') ?? this.adminEmail;
    if (apiKey && this.senderEmail) {
      this.client = new Resend(apiKey);
    } else {
      this.logger.warn('Resend delivery is disabled; configure RESEND_API_KEY and a verified RESEND_FROM_EMAIL');
    }
  }

  isConfigured(): boolean { return Boolean(this.client && this.senderEmail); }

  isTestSender(): boolean { return (this.senderEmail ?? '').toLowerCase().endsWith('@resend.dev'); }

  prepareJob(input: { id?: string; email: string; subject: string; text: string; html: string }): EmailSnapshot {
    return { from: `${this.senderName.replace(/[<>\r\n]/g, '')} <${this.senderEmail}>`, to: [input.email], replyTo: this.adminEmail,
      subject: input.subject, text: input.text, html: emailLayout(input.html),
      tags: [{ name: 'category', value: 'marketplace-transactional' }, ...(input.id ? [{ name: 'outbox_id', value: input.id }] : [])] };
  }

  async sendJob(input: { id: string; email: string; subject: string; text: string; html: string; snapshot?: EmailSnapshot }): Promise<EmailDeliveryResult> {
    return this.sendMessage({ to: { email: input.email, name: 'MoreLi' }, subject: input.subject,
      text: input.text, html: input.html, tag: 'marketplace-transactional', idempotencyKey: input.id, snapshot: input.snapshot });
  }

  sendTeacherReviewSubmitted(input: {
    teacherName: string;
    headline: string;
    approvalUrl: string;
  }): Promise<boolean> {
    return this.send({
      to: { email: this.adminEmail, name: 'Erik' },
      subject: `Tutor review required: ${input.teacherName}`,
      text: `${input.teacherName} submitted a tutor profile for review. ${input.headline}\n\nReview and approve: ${input.approvalUrl}`,
      html: `<h2>New tutor profile awaiting review</h2><p><strong>${escapeHtml(input.teacherName)}</strong></p><p>${escapeHtml(input.headline)}</p><p><a href="${escapeHtml(input.approvalUrl)}">Review and approve this tutor</a></p><p>This link expires in 7 days. Approval requires a confirmation click.</p>`,
      tag: 'teacher-review',
    });
  }

  deliverJob(input: { id: string; email: string; subject: string; text: string; html: string }): Promise<boolean> {
    return this.send({
      to: { email: input.email, name: 'MoreLi' },
      subject: input.subject,
      text: input.text,
      html: input.html,
      tag: 'marketplace-transactional',
      idempotencyKey: input.id,
    });
  }

  sendTeacherApproved(teacher: Contact): Promise<boolean> {
    return this.sendToContact(
      teacher,
      'Your MoreLi tutor profile was approved',
      'Your tutor profile was approved and is now visible to students.',
      'teacher-approved',
    );
  }

  sendTeacherReviewReceived(teacher: Contact): Promise<boolean> {
    return this.sendToContact(
      teacher,
      'We received your MoreLi tutor profile',
      'Your tutor profile was saved and sent for review. It is not public yet. We will email you after the review is complete.',
      'teacher-review-received',
    );
  }

  async sendLessonRequestCreated(details: LessonDetails): Promise<void> {
    const schedule = formatSchedule(details);
    await Promise.all([
      this.sendToContact(
        details.teacher,
        `New lesson request from ${details.student.name}`,
        `${details.student.name} requested a lesson${schedule}. Sign in to accept or decline.`,
        'lesson-request-teacher',
      ),
      this.sendToContact(
        details.student,
        `Your request to ${details.teacher.name} was sent`,
        `We sent your lesson request${schedule}. We will email you when the tutor responds.`,
        'lesson-request-student',
      ),
    ]);
  }

  async sendLessonRequestResponded(
    details: LessonDetails,
    status: 'accepted' | 'declined',
  ): Promise<void> {
    const accepted = status === 'accepted';
    const studentContact = accepted ? contactLine(details.student) : '';
    const teacherContact = accepted ? contactLine(details.teacher) : '';
    await Promise.all([
      this.sendToContact(
        details.student,
        accepted ? `${details.teacher.name} accepted your lesson request` : `${details.teacher.name} declined your lesson request`,
        accepted
          ? `The tutor accepted your request. Contact details: ${teacherContact}`
          : 'The tutor could not accept this request. You can continue searching for another tutor.',
        `lesson-${status}-student`,
      ),
      this.sendToContact(
        details.teacher,
        accepted ? `You accepted ${details.student.name}'s request` : `You declined ${details.student.name}'s request`,
        accepted
          ? `The request is recorded as accepted. Student contact details: ${studentContact}`
          : 'The student was notified that you declined the request.',
        `lesson-${status}-teacher`,
      ),
    ]);
  }

  private sendToContact(
    contact: Contact,
    subject: string,
    text: string,
    tag: string,
  ): Promise<boolean> {
    if (!contact.email) {
      this.logger.warn(`Skipped ${tag}: recipient has no synchronized email`);
      return Promise.resolve(false);
    }
    return this.send({ to: contact, subject, text, html: `<p>${escapeHtml(text)}</p>`, tag });
  }

  private async send(input: {
    to: Contact;
    subject: string;
    text: string;
    html: string;
    tag: string;
    idempotencyKey?: string;
  }): Promise<boolean> {
    return (await this.sendMessage(input)).accepted;
  }

  private async sendMessage(input: { to: Contact; subject: string; text: string; html: string; tag: string; idempotencyKey?: string; snapshot?: EmailSnapshot }): Promise<EmailDeliveryResult> {
    if (!this.client || !this.senderEmail) return { accepted: false, retryable: true, errorCode: 'configuration_missing' };
    if (!input.to.email) return { accepted: false, retryable: false, errorCode: 'recipient_missing' };
    try {
      const snapshot = input.snapshot ?? this.prepareJob({ id: input.idempotencyKey, email: input.to.email, subject: input.subject, text: input.text, html: input.html });
      if (this.isTestSender() && snapshot.to.some((address) => address.trim().toLowerCase() !== this.testRecipientEmail.trim().toLowerCase())) {
        return { accepted: false, retryable: true, errorCode: 'test_sender_recipient_restricted' };
      }
      const { data, error, headers } = await this.client.emails.send(snapshot,
        { ...(input.idempotencyKey ? { idempotencyKey: `moreli/${input.idempotencyKey}` } : {}), signal: AbortSignal.timeout(10000) });
      if (error) {
        const status = error.statusCode ?? 0;
        const retryable = status === 0 || status === 429 || status >= 500 || error.name === 'concurrent_idempotent_requests' || ['daily_quota_exceeded', 'monthly_quota_exceeded'].includes(error.name);
        const retryAfter = Number(headers?.['retry-after']);
        this.logger.warn(`Resend delivery rejected: code=${error.name}, status=${status}`);
        return { accepted: false, retryable, errorCode: error.name,
          ...(error.name === 'daily_quota_exceeded' ? { retryAfterSeconds: 86400 } : Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: Math.min(86400, Math.ceil(retryAfter)) } : {}) };
      }
      return data?.id ? { accepted: true, retryable: false, messageId: data.id } : { accepted: false, retryable: true, errorCode: 'missing_provider_id' };
    } catch {
      this.logger.warn('Resend delivery interrupted: network error or timeout');
      return { accepted: false, retryable: true, errorCode: 'network_or_timeout' };
    }
  }
}

function contactLine(contact: Contact): string {
  return [contact.email, contact.phone].filter(Boolean).join(' / ');
}

function formatSchedule(details: LessonDetails): string {
  if (!details.requestedStartAt) return '';
  const formatted = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date(details.requestedStartAt));
  return ` for ${formatted}${details.lessonMode ? ` (${details.lessonMode})` : ''}`;
}

function emailLayout(content: string): string {
  return `<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;color:#0c244f"><h1 style="font-size:24px;border-bottom:3px solid #ff5a0a;padding-bottom:12px">מורהלי</h1>${content}<p style="color:#627d98;font-size:12px">הודעה תפעולית על הפעילות בחשבון מורהלי. לתמיכה אפשר להשיב להודעה.</p></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);
}