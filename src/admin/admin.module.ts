import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { AdminService } from './admin.service.js';
import { TeacherApprovalsController } from './teacher-approvals.controller.js';

@Module({
  controllers: [AdminController, TeacherApprovalsController],
  providers: [AdminService, AdminRepository],
})
export class AdminModule {}