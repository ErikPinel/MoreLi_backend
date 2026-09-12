import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
import { IdentityService } from './identity.service.js';

@Module({
	controllers: [UsersController],
	providers: [UsersService, UsersRepository, IdentityService],
})
export class UsersModule {}
