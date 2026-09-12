import { BrevoClient } from '@getbrevo/brevo';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  private readonly client?: BrevoClient;
  private readonly senderEmail?: string;
  private readonly senderName: string;
  private readonly adminEmail: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = configService.get<string>('email.brevoApiKey');
    this.senderEmail = configService.get<string>('email.senderEmail') || undefined;
    this.senderName = configService.get<string>('email.senderName') ?? 'MoreLi';
    this.adminEmail = configService.get<string>('email.adminEmail') ?? 'erik.zusin@gmail.com';
    if (apiKey && this.senderEmail) {
      this.client = new BrevoClient({ apiKey, timeoutInSeconds: 8, maxRetries: 0 });
    } else {
      this.logger.warn('Brevo email delivery is disabled; configure BREVO_API_KEY and BREVO_SENDER_EMAIL');
    }
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
    if (!this.client || !this.senderEmail) return false;
    try {
      await this.client.transactionalEmails.sendTransacEmail({
        sender: { email: this.senderEmail, name: this.senderName },
        to: [{ email: input.to.email!, name: input.to.name }],
        replyTo: { email: this.adminEmail, name: 'MoreLi support' },
        subject: input.subject,
        textContent: input.text,
        htmlContent: emailLayout(input.html),
        tags: [input.tag],
        headers: input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      });
      return true;
    } catch {
      this.logger.error(`Brevo delivery failed for ${input.tag}`);
      return false;
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
  return `<div dir="ltr" style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#102a43"><h1 style="font-size:24px">MoreLi</h1>${content}<p style="color:#627d98;font-size:12px">This is a transactional message about your MoreLi account.</p></div>`;
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