import { Module } from '@nestjs/common';
import { AccessController } from './access.controller.js';
import { AccessRepository } from './access.repository.js';

@Module({ controllers: [AccessController], providers: [AccessRepository] })
export class AccessModule {}