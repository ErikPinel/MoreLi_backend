import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { SupabaseService } from '../database/supabase.service.js';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  constructor(private readonly config: ConfigService, private readonly supabase: SupabaseService) {}

  async verifiedEmail(user: AuthUser): Promise<string> {
    if (user.identityProvider === 'supabase') {
      const { data, error } = await this.supabase.client.auth.admin.getUserById(user.sub);
      if (error || !data.user?.email_confirmed_at || !data.user.email) {
        throw new ServiceUnavailableException('Verified account email is unavailable');
      }
      return data.user.email.toLowerCase();
    }
    const response = await this.clerkRequest(user, 'GET');
    const data = await response.json() as {
      primary_email_address_id: string;
      email_addresses: { id: string; email_address: string; verification?: { status: string } }[];
    };
    const primary = data.email_addresses.find((email) => email.id === data.primary_email_address_id);
    if (!primary || primary.verification?.status !== 'verified') {
      this.logger.warn('Clerk primary email is missing or unverified');
      throw new ForbiddenException({ code: 'EMAIL_VERIFICATION_REQUIRED', message: 'יש לאמת את כתובת המייל הראשית בחשבון כדי להמשיך.' });
    }
    return primary.email_address.toLowerCase();
  }

  async deleteClerkAccount(user: AuthUser): Promise<void> {
    await this.clerkRequest(user, 'DELETE');
  }

  private async clerkRequest(user: AuthUser, method: 'GET' | 'DELETE'): Promise<Response> {
    const key = this.config.get<string>('clerk.secretKey');
    if (!key || !user.externalSubject) {
      this.logger.error(`Clerk configuration unavailable: serverKeyPresent=${Boolean(key)}, externalSubjectPresent=${Boolean(user.externalSubject)}`);
      throw new ServiceUnavailableException('Account provider is not configured');
    }
    let response: Response;
    try {
      response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(user.externalSubject)}`, {
        method,
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      this.logger.error('Clerk request failed: network error or timeout');
      throw new ServiceUnavailableException('Account provider is unavailable');
    }
    if (!response.ok) {
      this.logger.error(`Clerk request failed: method=${method}, status=${response.status}`);
      throw new ServiceUnavailableException('Account provider request failed');
    }
    return response;
  }
}