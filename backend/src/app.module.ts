import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './common/audit/audit.module';
import { MailModule } from './common/mail/mail.module';
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
import { BoardModule } from './board/board.module';
import { KbModule } from './kb/kb.module';
import { LoyverseModule } from './loyverse/loyverse.module';
import { ReservationsModule } from './reservations/reservations.module';
import { CustomersModule } from './customers/customers.module';
import { CommunicationsModule } from './communications/communications.module';
import { MeModule } from './me/me.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuditModule,
    MailModule,
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
    BoardModule,
    KbModule,
    LoyverseModule,
    ReservationsModule,
    CustomersModule,
    CommunicationsModule,
    MeModule,
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
