import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LeaveStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { MailService } from '../../common/mail/mail.service';
import { venueLogoAbsoluteUrl } from '../../common/venue-url/venue-url';
import { escapeHtml } from '../../common/mail/escape-html';
import {
  AuthenticatedUser,
  requireVenueId,
} from '../../common/decorators/current-user.decorator';
import { CreateLeaveRequestDto } from '../dto/create-leave-request.dto';
import { ReviewLeaveRequestDto } from '../dto/review-leave-request.dto';

const typeLabels: Record<string, string> = {
  VACATION: 'Ferie',
  PERMIT: 'Permesso',
  SICKNESS: 'Malattia',
};

@Injectable()
export class LeaveRequestsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private mail: MailService,
  ) {}

  private async resolveEmployeeId(userId: string): Promise<string> {
    const employee = await this.prisma.employee.findUnique({ where: { userId } });
    if (!employee) throw new BadRequestException('Utente non collegato a un dipendente');
    return employee.id;
  }

  /**
   * L'Admin (che non ha un Employee proprio) sceglie per quale dipendente
   * creare la richiesta; chiunque altro la crea sempre per sé stesso, anche
   * se per errore/manomissione arrivasse un employeeId nel corpo.
   */
  private async resolveTargetEmployeeId(
    user: AuthenticatedUser,
    requestedEmployeeId?: string,
  ): Promise<string> {
    if (user.role !== 'ADMIN' || !requestedEmployeeId) {
      return this.resolveEmployeeId(user.userId);
    }
    const employee = await this.prisma.employee.findUnique({
      where: { id: requestedEmployeeId },
    });
    if (!employee || employee.venueId !== requireVenueId(user)) {
      throw new NotFoundException('Dipendente non trovato');
    }
    return employee.id;
  }

  async create(user: AuthenticatedUser, dto: CreateLeaveRequestDto) {
    const employeeId = await this.resolveTargetEmployeeId(user, dto.employeeId);
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

    await this.notifyVenueByEmail(requireVenueId(user), employee, request);

    return request;
  }

  /**
   * Come per le prenotazioni: l'email del locale (Impostazioni locale, non
   * quella di login del singolo utente) riceve un avviso su ogni nuova
   * richiesta di ferie/permesso/malattia, così l'amministratore non deve
   * tenere l'app aperta per accorgersene. Solo informativa (l'approvazione
   * resta dall'app): a differenza delle prenotazioni non c'è un token
   * pubblico da proteggere qui, quindi niente pulsanti Accetta/Rifiuta via
   * link.
   */
  private async notifyVenueByEmail(
    venueId: string,
    employee: { firstName: string; lastName: string } | null,
    request: {
      type: string;
      startDate: Date;
      endDate: Date;
      note: string | null;
    },
  ): Promise<void> {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { email: true, name: true, slug: true, logoUrl: true },
    });
    if (!venue?.email || !employee) return;

    const when = `${request.startDate.toLocaleDateString('it-IT')} — ${request.endDate.toLocaleDateString('it-IT')}`;
    const typeLabel = typeLabels[request.type] ?? request.type;

    await this.mail.send({
      to: venue.email,
      subject: `Nuova richiesta di ${typeLabel.toLowerCase()} — ${employee.firstName} ${employee.lastName}`,
      text: [
        `${employee.firstName} ${employee.lastName} ha inviato una nuova richiesta di ${typeLabel.toLowerCase()}.`,
        `Periodo: ${when}`,
        ...(request.note ? [`Note: ${request.note}`] : []),
        '',
        'Puoi approvarla o rifiutarla dall\'app, sezione Presenze > Richieste ferie/permessi.',
      ].join('\n'),
      html: `<div style="font-family:sans-serif;color:#222;">
        <h2>Nuova richiesta di ${escapeHtml(typeLabel.toLowerCase())}</h2>
        <p><strong>${escapeHtml(employee.firstName)} ${escapeHtml(employee.lastName)}</strong></p>
        <p>Periodo: ${escapeHtml(when)}</p>
        ${request.note ? `<p>Note: ${escapeHtml(request.note)}</p>` : ''}
        <p>Puoi approvarla o rifiutarla dall'app, sezione Presenze &gt; Richieste ferie/permessi.</p>
      </div>`,
      venueName: venue.name,
      logoUrl: venueLogoAbsoluteUrl(venue),
    });
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

  /**
   * Una richiesta approvata può sempre essere cancellata dall'admin o da un
   * responsabile (Employee.isManager), ad es. per correggere un errore o un
   * cambio di programma. Le richieste non ancora approvate si gestiscono con
   * review() (approva/rifiuta), non con la cancellazione.
   */
  async remove(user: AuthenticatedUser, requestId: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!request || request.employee.venueId !== requireVenueId(user)) {
      throw new NotFoundException('Richiesta non trovata');
    }
    if (request.status !== 'APPROVED') {
      throw new BadRequestException('Solo le richieste approvate possono essere eliminate.');
    }
    await this.assertCanManage(user);

    await this.prisma.leaveRequest.delete({ where: { id: requestId } });

    await this.audit.log({
      venueId: requireVenueId(user),
      userId: user.userId,
      entity: 'LeaveRequest',
      entityId: requestId,
      action: 'DELETE',
      before: request,
    });

    return { success: true };
  }

  /** Richieste approvate del locale, per chi può eliminarle (admin o responsabile). */
  async listApprovedForManager(user: AuthenticatedUser) {
    await this.assertCanManage(user);
    return this.prisma.leaveRequest.findMany({
      where: { employee: { venueId: requireVenueId(user) }, status: 'APPROVED' },
      include: { employee: true },
      orderBy: { startDate: 'desc' },
    });
  }

  private async assertCanManage(user: AuthenticatedUser): Promise<void> {
    if (user.role === 'ADMIN') return;
    const employee = await this.prisma.employee.findUnique({ where: { userId: user.userId } });
    if (!employee?.isManager) {
      throw new ForbiddenException(
        "Solo l'admin o un responsabile possono eliminare una richiesta approvata.",
      );
    }
  }
}
