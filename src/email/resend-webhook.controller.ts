import { BadRequestException, Controller, HttpCode, Post, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Resend } from 'resend';
import { Public } from '../common/decorators/public.decorator.js';
import { SupabaseService } from '../database/supabase.service.js';

const deliveryEvents = new Set(['email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('webhooks/resend')
export class ResendWebhookController {
  constructor(private readonly config: ConfigService, private readonly supabase: SupabaseService) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() request: Request) {
    const secret = this.config.get<string>('email.webhookSecret');
    if (!secret) throw new ServiceUnavailableException('Email webhook verification is not configured');
    const id = request.headers['svix-id'];
    const timestamp = request.headers['svix-timestamp'];
    const signature = request.headers['svix-signature'];
    if (!Buffer.isBuffer(request.body) || typeof id !== 'string' || id.length > 200 || typeof timestamp !== 'string' || typeof signature !== 'string') {
      throw new UnauthorizedException('Invalid email webhook');
    }
    let event: { type: string; created_at: string; data: { email_id?: string; tags?: Record<string, string> | { name: string; value: string }[] } };
    try {
      const resend = new Resend(this.config.get<string>('email.resendApiKey') || 'webhook-verification-only');
      event = resend.webhooks.verify({ payload: request.body.toString('utf8'), headers: { id, timestamp, signature }, webhookSecret: secret }) as unknown as typeof event;
    } catch { throw new UnauthorizedException('Invalid email webhook signature'); }
    if (!deliveryEvents.has(event.type)) return { recorded: false };
    if (!event.data?.email_id || !Number.isFinite(Date.parse(event.created_at))) throw new BadRequestException('Invalid email delivery event');
    const tags = event.data.tags;
    const taggedJob = Array.isArray(tags) ? tags.find((tag) => tag.name === 'outbox_id')?.value : tags?.outbox_id;
    const { data, error } = await this.supabase.client.rpc('record_resend_event', { p_event_id: id, p_message_id: event.data.email_id,
      p_type: event.type, p_occurred_at: new Date(event.created_at).toISOString(), p_job_id: taggedJob && uuidPattern.test(taggedJob) ? taggedJob : null });
    if (error) throw new ServiceUnavailableException('Email delivery receipt could not be saved');
    return { recorded: data };
  }
}