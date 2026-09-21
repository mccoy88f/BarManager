import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { LeaveRequestsService } from './leave-requests/leave-requests.service';
import { LeaveRequestsController } from './leave-requests/leave-requests.controller';

@Module({
  controllers: [AttendanceController, LeaveRequestsController],
  providers: [AttendanceService, LeaveRequestsService],
})
export class AttendanceModule {}
