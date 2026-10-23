import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import type { AuthUser } from '../common/types/auth-user.type.js';
import { CreateSupportTicketDto, ListSupportTicketsDto, ReplySupportTicketDto } from './support.dto.js';
import { SupportRepository } from './support.repository.js';

@Controller()
export class SupportController {
  constructor(private readonly repository:SupportRepository){}
  @Post('support/tickets') create(@CurrentUser() user:AuthUser,@Body() dto:CreateSupportTicketDto){return this.repository.create(user.sub,dto);}
  @Get('support/tickets') list(@CurrentUser() user:AuthUser,@Query() query:ListSupportTicketsDto){return this.repository.list(user.sub,query);}
  @Get('support/tickets/:id') detail(@CurrentUser() user:AuthUser,@Param('id',new ParseUUIDPipe()) id:string){return this.repository.detail(user.sub,id);}
  @Post('support/tickets/:id/messages') reply(@CurrentUser() user:AuthUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() dto:ReplySupportTicketDto){return this.repository.reply(user.sub,id,dto);}
  @Roles('admin') @Get('admin/support-tickets') adminList(@CurrentUser() user:AuthUser,@Query() query:ListSupportTicketsDto){return this.repository.list(user.sub,query,true);}
  @Roles('admin') @Get('admin/support-tickets/:id') adminDetail(@CurrentUser() user:AuthUser,@Param('id',new ParseUUIDPipe()) id:string){return this.repository.detail(user.sub,id,true);}
  @Roles('admin') @Post('admin/support-tickets/:id/messages') adminReply(@CurrentUser() user:AuthUser,@Param('id',new ParseUUIDPipe()) id:string,@Body() dto:ReplySupportTicketDto){return this.repository.reply(user.sub,id,dto);}
}