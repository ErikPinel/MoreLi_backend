import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { Profile } from './users.repository.js';
import { UsersService } from './users.service.js';
import { IdentityService } from './identity.service.js';
import { BadRequestException } from '@nestjs/common';

@Controller('users/me')
export class UsersController {
  constructor(private readonly usersService: UsersService, private readonly identity: IdentityService) {}

  @Get()
  async findMe(@CurrentUser() user: AuthUser): Promise<Profile> {
    const profile = await this.usersService.findMe(user.sub);
    const email = await this.identity.verifiedEmail(user);
    return profile.contact_email === email ? profile : this.usersService.updateMe(user.sub, { contactEmail: email });
  }

  @Patch()
  async updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<Profile> {
    if (dto.contactEmail !== undefined) {
      const email = await this.identity.verifiedEmail(user);
      if (dto.contactEmail.trim().toLowerCase() !== email) {
        throw new BadRequestException('Contact email must match your verified primary account email');
      }
      dto.contactEmail = email;
    }
    return this.usersService.updateMe(user.sub, dto);
  }

  @Delete()
  async deleteMe(@CurrentUser() user: AuthUser) {
    if (user.identityProvider === 'clerk') await this.identity.deleteClerkAccount(user);
    await this.usersService.deleteMe(user.sub, user.identityProvider);
    return { deleted: true };
  }
}