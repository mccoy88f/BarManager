import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Riepilogo per la home dell'amministrazione: richieste dei dipendenti in
 * attesa, fornitori da ordinare oggi (in base ai giorni impostati),
 * scadenze da "Attività e scadenze" imminenti/scadute, e le altre
 * notifiche del giorno (temperature fuori soglia, ordini inviati, ecc.).
 */
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getAdminSummary(venueId: string, userId: string) {
    const isoWeekday = ((new Date().getDay() + 6) % 7) + 1; // 1=lun .. 7=dom
    const now = new Date();

    const [pendingLeaveRequests, notifications, ordersDueToday, openTasks] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { employee: { venueId }, status: 'PENDING' },
        include: { employee: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.notification.findMany({
        where: { userId, read: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.supplier.findMany({
        where: { venueId, orderDays: { has: isoWeekday } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.task.findMany({
        where: { venueId, status: 'OPEN' },
        include: { relatedEmployee: true },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
    ]);

    const tasks = openTasks.map((task) => {
      const msUntilDue = task.dueDate.getTime() - now.getTime();
      const overdue = msUntilDue < 0;
      const dueSoon = !overdue && msUntilDue <= task.reminderDaysBefore * 24 * 60 * 60 * 1000;
      return { ...task, overdue, dueSoon };
    });

    return {
      pendingLeaveRequests,
      notifications,
      ordersDueToday,
      tasksDueSoon: tasks.filter((t) => t.overdue || t.dueSoon),
      tasksOverdueCount: tasks.filter((t) => t.overdue).length,
    };
  }
}
