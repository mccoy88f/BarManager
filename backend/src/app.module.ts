import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './common/audit/audit.module';
import { ReportsModule } from './reports/reports.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AttendanceModule } from './attendance/attendance.module';
import { HaccpModule } from './haccp/haccp.module';
import { InventoryModule } from './inventory/inventory.module';
import { PrintingModule } from './printing/printing.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuditModule,
    ReportsModule,
    AuthModule,
    UsersModule,
    AttendanceModule,
    HaccpModule,
    InventoryModule,
    PrintingModule,
  ],
})
export class AppModule {}
