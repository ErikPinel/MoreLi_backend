import { SetMetadata } from '@nestjs/common';
import { Database } from '../../database/database.types.js';

export type UserRole = Database['public']['Enums']['user_role'];
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);