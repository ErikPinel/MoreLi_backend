import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { ListRequestsDto } from './dto/list-requests.dto.js';
import { StudentRequest } from './requests.repository.js';
import { RequestsService } from './requests.service.js';

@Controller('requests')
@Roles('student')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRequestDto,
  ): Promise<StudentRequest> {
    return this.requestsService.create(user.sub, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ListRequestsDto) {
    return this.requestsService.findAll(user.sub, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<StudentRequest> {
    return this.requestsService.findOne(user.sub, id);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateRequestDto,
  ): Promise<StudentRequest> {
    return this.requestsService.update(user.sub, id, dto);
  }

  @Post(':id/close')
  close(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<StudentRequest> {
    return this.requestsService.close(user.sub, id);
  }
}