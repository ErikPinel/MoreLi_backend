import { BadRequestException, Injectable } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { Profile, UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findMe(userId: string): Promise<Profile> {
    return this.usersRepository.findById(userId);
  }

  updateMe(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    if (dto.avatarPath && !dto.avatarPath.startsWith(`${userId}/`)) {
      throw new BadRequestException('Avatar path must belong to the current user');
    }
    return this.usersRepository.update(userId, dto);
  }

  deleteMe(
    userId: string,
    identityProvider: 'clerk' | 'supabase',
  ): Promise<void> {
    return this.usersRepository.deleteAccount(userId, identityProvider);
  }
}