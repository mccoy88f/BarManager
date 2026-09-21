import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  AuthenticatedUser,
  requireVenueId,
} from '../../common/decorators/current-user.decorator';
import { CreateLeaveRequestDto } from '../dto/create-leave-request.dto';
import { ReviewLeaveRequestDto } from '../dto/review-leave-request.dto';

@Injectable()
export class LeaveRequestsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async resolveEmployeeId(userId: string): Promise<string> {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Utente non collegato a un dipendente');
    return employee.id;
  }

  async create(user: AuthenticatedUser, dto: CreateLeaveRequestDto) {
    const employeeId = await this.resolveEmployeeId(user.userId);
    const request = await this.prisma.leaveRequest.create({
      data: {
        employeeId,
        type: dto.type,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        partialDay: dto.partialDay ?? false,
        startTime: dto.startTime,
        endTime: dto.endTime,
        note: dto.note,
      },
    });

    // Notifica ai responsabili del reparto / admin
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    const reviewers = await this.prisma.user.findMany({
      where: {
        venueId: requireVenueId(user),
        OR: [{ role: 'ADMIN' }, { employee: { department: employee?.department, isManager: true } }],
      },
    });
    await this.prisma.notification.createMany({
      data: reviewers.map((r) => ({
        userId: r.id,
        type: 'LEAVE_REQUEST_PENDING',
        message: `Nuova richiesta di assenza da ${employee?.firstName} ${employee?.lastName}`,
      })),
    });

    return request;
  }

  listMine(userId: string) {
    return this.resolveEmployeeId(userId).then((employeeId) =>
      this.prisma.leaveRequest.findMany({
        where: { employeeId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  listForVenue(venueId: string, status?: LeaveStatus) {
    return this.prisma.leaveRequest.findMany({
      where: { employee: { venueId }, status },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async review(reviewer: AuthenticatedUser, requestId: string, dto: ReviewLeaveRequestDto) {
    const before = await this.prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!before) throw new NotFoundException('Richiesta non trovata');

    const after = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: dto.status,
        reviewNote: dto.reviewNote,
        reviewedById: reviewer.userId,
        reviewedAt: new Date(),
      },
      include: { employee: true },
    });

    await this.audit.log({
      venueId: requireVenueId(reviewer),
      userId: reviewer.userId,
      entity: 'LeaveRequest',
      entityId: requestId,
      action: 'UPDATE',
      before,
      after,
    });

    if (after.employee.userId) {
      await this.prisma.notification.create({
        data: {
          userId: after.employee.userId,
          type: 'LEAVE_REQUEST_REVIEWED',
          message: `La tua richiesta di assenza è stata ${dto.status === 'APPROVED' ? 'approvata' : 'rifiutata'}`,
        },
      });
    }

    return after;
  }
}
