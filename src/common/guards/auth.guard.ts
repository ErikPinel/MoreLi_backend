import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SupabaseService } from '../../database/supabase.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AuthUser } from '../types/auth-user.type.js';

type AuthenticatedRequest = Request & { authUser?: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('Bearer token required');

    const { data, error } = await this.supabase.client.auth.getClaims(match[1]);
    const claims = data?.claims;
    if (error || typeof claims?.sub !== 'string') {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    request.authUser = {
      sub: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      role: typeof claims.role === 'string' ? claims.role : undefined,
      appMetadata:
        typeof claims.app_metadata === 'object' && claims.app_metadata !== null
          ? claims.app_metadata
          : undefined,
      userMetadata:
        typeof claims.user_metadata === 'object' && claims.user_metadata !== null
          ? claims.user_metadata
          : undefined,
    };
    return true;
  }
}
