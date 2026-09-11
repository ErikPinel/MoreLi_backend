import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { CreateRequestDto } from '../requests/dto/create-request.dto.js';
import { MatchingService, RankedTeacher } from './matching.service.js';

@Controller()
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Public()
  @Post('matching/preview')
  preview(@Body() dto: CreateRequestDto): Promise<RankedTeacher[]> {
    return this.matchingService.preview(dto);
  }

  @Post('requests/:id/matches')
  @Roles('student')
  run(
    @CurrentUser() user: AuthUser,
    @Param('id') requestId: string,
  ): Promise<RankedTeacher[]> {
    return this.matchingService.run(user.sub, requestId);
  }

  @Get('requests/:id/matches')
  @Roles('student')
  findForRequest(
    @CurrentUser() user: AuthUser,
    @Param('id') requestId: string,
  ): Promise<RankedTeacher[]> {
    return this.matchingService.findForRequest(user.sub, requestId);
  }
}