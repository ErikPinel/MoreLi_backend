import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { AvailabilityService } from './availability.service.js';
import {
  AvailabilityQueryDto,
  ReplaceAvailabilityDto,
} from './dto/availability.dto.js';

@Controller()
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Public()
  @Get('teachers/:slug/availability')
  findPublic(
    @Param('slug') slug: string,
    @Query() query: AvailabilityQueryDto,
  ) {
    return this.availabilityService.findPublic(slug, query.at);
  }

  @Get('teachers/me/schedule')
  @Roles('teacher')
  findMine(@CurrentUser() user: AuthUser) {
    return this.availabilityService.findMine(user.sub);
  }

  @Put('teachers/me/availability')
  @Roles('teacher')
  replaceMine(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReplaceAvailabilityDto,
  ) {
    return this.availabilityService.replaceMine(user.sub, dto);
  }
}