import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SupabaseService } from '../../database/supabase.service.js';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator.js';
import { AuthUser } from '../types/auth-user.type.js';

type AuthenticatedRequest = Request & { authUser?: AuthUser };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authUser;
    if (!user?.sub) throw new UnauthorizedException();

    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('role')
      .eq('id', user.sub)
      .maybeSingle();
    if (error || !data) throw new UnauthorizedException();
    if (!roles.includes(data.role)) {
      throw new ForbiddenException('This account role cannot perform that action');
    }
    return true;
  }
}