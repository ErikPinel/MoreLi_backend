import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { FavoritesService } from './favorites.service.js';

@Controller('favorites')
@Roles('student')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.favoritesService.findAll(user.sub);
  }

  @Post(':teacherId')
  add(
    @CurrentUser() user: AuthUser,
    @Param('teacherId') teacherId: string,
  ) {
    return this.favoritesService.add(user.sub, teacherId);
  }

  @Delete(':teacherId')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('teacherId') teacherId: string,
  ) {
    await this.favoritesService.remove(user.sub, teacherId);
    return { removed: true };
  }
}