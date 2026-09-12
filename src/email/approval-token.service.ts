import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

type ApprovalPayload = {
  teacherId: string;
  expiresAt: number;
};

const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class ApprovalTokenService {
  constructor(private readonly configService: ConfigService) {}

  create(teacherId: string): string | null {
    const secret = this.secret();
    if (!secret) return null;
    const payload = Buffer.from(
      JSON.stringify({
        teacherId,
        expiresAt: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
      } satisfies ApprovalPayload),
    ).toString('base64url');
    return `${payload}.${this.sign(payload, secret)}`;
  }

  verify(token: string): ApprovalPayload {
    const secret = this.secret();
    if (!secret) throw new BadRequestException('Email approval is not configured');
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) this.invalid();
    const expected = Buffer.from(this.sign(payload, secret));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      this.invalid();
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as ApprovalPayload;
      if (
        typeof parsed.teacherId !== 'string' ||
        typeof parsed.expiresAt !== 'number' ||
        parsed.expiresAt < Math.floor(Date.now() / 1000)
      ) {
        this.invalid();
      }
      return parsed;
    } catch {
      this.invalid();
    }
  }

  approvalUrl(token: string): string {
    const baseUrl = this.configService.getOrThrow<string>('publicAppUrl');
    return `${baseUrl.replace(/\/$/, '')}/teacher-approval?token=${encodeURIComponent(token)}`;
  }

  private secret(): string | undefined {
    return this.configService.get<string>('email.approvalSecret') || undefined;
  }

  private sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  private invalid(): never {
    throw new BadRequestException('Approval link is invalid or expired');
  }
}