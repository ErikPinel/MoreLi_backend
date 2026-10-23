import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { LessonsController } from './lessons.controller.js';
import { LessonsRepository } from './lessons.repository.js';

@Module({ imports: [AvailabilityModule], controllers: [LessonsController], providers: [LessonsRepository] })
export class LessonsModule {}
