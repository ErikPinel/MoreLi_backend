import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { Profile } from './users.repository.js';
import { UsersService } from './users.service.js';

@Controller('users/me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findMe(@CurrentUser() user: AuthUser): Promise<Profile> {
    return this.usersService.findMe(user.sub);
  }

  @Patch()
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<Profile> {
    return this.usersService.updateMe(user.sub, dto);
  }

  @Delete()
  async deleteMe(@CurrentUser() user: AuthUser) {
    await this.usersService.deleteMe(user.sub);
    return { deleted: true };
  }
}