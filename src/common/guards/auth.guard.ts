import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { createRemoteJWKSet, decodeJwt, jwtVerify, JWTPayload } from 'jose';
import { SupabaseService } from '../../database/supabase.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { AuthUser } from '../types/auth-user.type.js';

type AuthenticatedRequest = Request & { authUser?: AuthUser };

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly clerkIssuer: string;
  private readonly clerkJwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.clerkIssuer = this.configService.getOrThrow<string>('clerk.issuer');
    this.clerkJwks = createRemoteJWKSet(
      new URL(`${this.clerkIssuer}/.well-known/jwks.json`),
    );
  }

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

    const claims = await this.verifyToken(match[1]);
    const subject = await this.resolveSubject(claims);

    request.authUser = {
      sub: subject,
      externalSubject: claims.sub,
      identityProvider:
        claims.iss === this.clerkIssuer ? 'clerk' : 'supabase',
      email: typeof claims.email === 'string' ? claims.email : undefined,
      role: typeof claims.role === 'string' ? claims.role : undefined,
      appMetadata: isRecord(claims.app_metadata)
        ? claims.app_metadata
        : undefined,
      userMetadata: isRecord(claims.user_metadata)
        ? claims.user_metadata
        : undefined,
    };
    return true;
  }

  private async verifyToken(token: string): Promise<JWTPayload> {
    let issuer: unknown;
    try {
      issuer = decodeJwt(token).iss;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (issuer === this.clerkIssuer) {
      try {
        const { payload } = await jwtVerify(token, this.clerkJwks, {
          algorithms: ['RS256'],
          issuer: this.clerkIssuer,
        });
        const authorizedParty = payload.azp;
        const allowedOrigins = this.configService.getOrThrow<string[]>(
          'app.corsOrigins',
        );
        if (
          typeof authorizedParty === 'string' &&
          !allowedOrigins.includes(authorizedParty)
        ) {
          throw new UnauthorizedException('Invalid authorized party');
        }
        if (payload.sts === 'pending') {
          throw new UnauthorizedException('Account setup is incomplete');
        }
        return payload;
      } catch (error) {
        if (error instanceof UnauthorizedException) throw error;
        throw new UnauthorizedException('Invalid or expired access token');
      }
    }

    const { data, error } = await this.supabase.client.auth.getClaims(token);
    if (error || typeof data?.claims?.sub !== 'string') {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    return data.claims;
  }

  private async resolveSubject(claims: JWTPayload): Promise<string> {
    if (typeof claims.sub !== 'string') {
      throw new UnauthorizedException('Token subject is missing');
    }
    if (claims.iss !== this.clerkIssuer) return claims.sub;

    const { data, error } = await this.supabase.client.rpc(
      'resolve_external_identity',
      {
        p_provider: 'clerk',
        p_subject: claims.sub,
        p_first_name:
          typeof claims.first_name === 'string' ? claims.first_name : '',
        p_last_name:
          typeof claims.last_name === 'string' ? claims.last_name : '',
      },
    );
    if (error || typeof data !== 'string') {
      throw new UnauthorizedException('Unable to resolve account');
    }
    return data;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
