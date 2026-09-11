import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

type DatabaseError = {
  code?: string;
};

export function throwSupabaseError(
  error: DatabaseError,
  fallbackMessage: string,
): never {
  switch (error.code) {
    case 'P0002':
    case 'PGRST116':
      throw new NotFoundException(fallbackMessage);
    case '23505':
      throw new ConflictException(fallbackMessage);
    case '22023':
    case '22P02':
    case '23514':
    case '23P01':
      throw new BadRequestException(fallbackMessage);
    case '42501':
      throw new ForbiddenException(fallbackMessage);
    default:
      throw new InternalServerErrorException(fallbackMessage);
  }
}