import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './common/audit/audit.module';
import { ReportsModule } from './reports/reports.module';
import { TenantMiddleware } from './common/tenant/tenant.middleware';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { VenuesModule } from './venues/venues.module';
import { AttendanceModule } from './attendance/attendance.module';
import { HaccpModule } from './haccp/haccp.module';
import { InventoryModule } from './inventory/inventory.module';
import { MenuModule } from './menu/menu.module';
import { TasksModule } from './tasks/tasks.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { PrintingModule } from './printing/printing.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuditModule,
    ReportsModule,
    AuthModule,
    UsersModule,
    VenuesModule,
    AttendanceModule,
    HaccpModule,
    InventoryModule,
    MenuModule,
    TasksModule,
    NotificationsModule,
    DashboardModule,
    PrintingModule,
    HealthModule,
  ],
  providers: [
    // ThrottlerModule era registrato ma mai applicato: senza questo guard
    // globale, login e menù pubblico restavano senza alcun limite di
    // richieste nonostante il rate limiting fosse un requisito esplicito.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
