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

    const overlapping = await this.findOverlapping(
      employeeId,
      request.startDate,
      request.endDate,
      request.id,
    );
    const overlapWarning =
      overlapping.length > 0
        ? `Attenzione: questa richiesta si sovrappone con ${overlapping.length === 1 ? "un'altra richiesta" : `altre ${overlapping.length} richieste`} già presente${overlapping.length === 1 ? '' : 'i'} per lo stesso dipendente.`
        : null;

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
        message: `Nuova richiesta di assenza da ${employee?.firstName} ${employee?.lastName}${overlapWarning ? ' — attenzione: si sovrappone con un\'altra richiesta dello stesso dipendente' : ''}`,
      })),
    });

    await this.notifyVenueByEmail(requireVenueId(user), employee, request, overlapWarning);

    return { ...request, overlapWarning };
  }

  /**
   * Richieste attive (PENDING/APPROVED, non REJECTED — una rifiutata non è
   * più un impegno reale) dello stesso dipendente il cui periodo si
   * sovrappone anche solo in parte a quello indicato. Usata sia per
   * segnalare l'incongruenza al momento dell'inserimento (sotto) sia per
   * marcarla nelle liste (vedi `annotateOverlaps`).
   */
  private findOverlapping(employeeId: string, startDate: Date, endDate: Date, excludeId?: string) {
    return this.prisma.leaveRequest.findMany({
      where: {
        employeeId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });
  }

  /**
   * Marca ogni richiesta con `hasOverlap: true` se si sovrappone (anche solo
   * in parte) con un'altra richiesta attiva dello stesso dipendente presente
   * nella stessa lista — calcolato sui dati già scaricati, senza nuove query,
   * così il segnale resta visibile anche dopo il momento dell'inserimento
   * (in coda, nello storico "le mie richieste"), non solo nel messaggio
   * mostrato subito a chi la crea.
   */
  private annotateOverlaps<
    T extends { id: string; employeeId: string; startDate: Date; endDate: Date; status: LeaveStatus },
  >(requests: T[]): (T & { hasOverlap: boolean })[] {
    return requests.map((r) => ({
      ...r,
      hasOverlap: requests.some(
        (other) =>
          other.id !== r.id &&
          other.employeeId === r.employeeId &&
          other.status !== 'REJECTED' &&
          r.status !== 'REJECTED' &&
          other.startDate <= r.endDate &&
          other.endDate >= r.startDate,
      ),
    }));
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
    overlapWarning?: string | null,
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
        ...(overlapWarning ? ['', overlapWarning] : []),
        '',
        'Puoi approvarla o rifiutarla dall\'app, sezione Presenze > Richieste ferie/permessi.',
      ].join('\n'),
      html: `<div style="font-family:sans-serif;color:#222;">
        <h2>Nuova richiesta di ${escapeHtml(typeLabel.toLowerCase())}</h2>
        <p><strong>${escapeHtml(employee.firstName)} ${escapeHtml(employee.lastName)}</strong></p>
        <p>Periodo: ${escapeHtml(when)}</p>
        ${request.note ? `<p>Note: ${escapeHtml(request.note)}</p>` : ''}
        ${overlapWarning ? `<p style="color:#c62828;"><strong>${escapeHtml(overlapWarning)}</strong></p>` : ''}
        <p>Puoi approvarla o rifiutarla dall'app, sezione Presenze &gt; Richieste ferie/permessi.</p>
      </div>`,
      venueName: venue.name,
      logoUrl: venueLogoAbsoluteUrl(venue),
    });
  }

  async listMine(userId: string) {
    const employeeId = await this.resolveEmployeeId(userId);
    const requests = await this.prisma.leaveRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return this.annotateOverlaps(requests);
  }

  async listForVenue(venueId: string, status?: LeaveStatus) {
    const requests = await this.prisma.leaveRequest.findMany({
      where: { employee: { venueId }, status },
      include: { employee: true },
      orderBy: { createdAt: 'desc' },
    });
    return this.annotateOverlaps(requests);
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
      include: { employee: { include: { user: { select: { email: true } } } } },
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

    await this.notifyEmployeeByEmail(requireVenueId(reviewer), after);

    return after;
  }

  /**
   * Email al dipendente sull'esito (approvata/rifiutata), simmetrica alla
   * notifica in-app già esistente sopra. Destinatario: l'email di contatto
   * propria dell'Employee se impostata (`Employee.email`, usata anche per CC
   * ordini, §5.3), altrimenti l'email di login del suo account utente
   * collegato (`Employee.user.email`) — stesso ordine di preferenza già
   * usato per i responsabili in CC alle email fornitori
   * (`OrdersService.sendOrder`). Nessuna delle due presente (dipendente
   * senza account e senza email di contatto) → nessuna email, non un errore.
   */
  private async notifyEmployeeByEmail(
    venueId: string,
    request: {
      type: string;
      status: string;
      startDate: Date;
      endDate: Date;
      reviewNote: string | null;
      employee: { firstName: string; email: string | null; user: { email: string } | null };
    },
  ): Promise<void> {
    const to = request.employee.email ?? request.employee.user?.email;
    if (!to) return;

    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { name: true, slug: true, logoUrl: true },
    });
    if (!venue) return;

    const typeLabel = typeLabels[request.type] ?? request.type;
    const when = `${request.startDate.toLocaleDateString('it-IT')} — ${request.endDate.toLocaleDateString('it-IT')}`;
    const verb = request.status === 'APPROVED' ? 'approvata' : 'rifiutata';

    await this.mail.send({
      to,
      subject: `${venue.name} — richiesta di ${typeLabel.toLowerCase()} ${verb}`,
      text: [
        `Ciao ${request.employee.firstName},`,
        '',
        `La tua richiesta di ${typeLabel.toLowerCase()} per il periodo ${when} è stata ${verb}.`,
        ...(request.reviewNote ? [`Nota: ${request.reviewNote}`] : []),
      ].join('\n'),
      html: `<div style="font-family:sans-serif;color:#222;">
        <p>Ciao ${escapeHtml(request.employee.firstName)},</p>
        <p>La tua richiesta di ${escapeHtml(typeLabel.toLowerCase())} per il periodo ${escapeHtml(when)} è stata <strong>${verb}</strong>.</p>
        ${request.reviewNote ? `<p>Nota: ${escapeHtml(request.reviewNote)}</p>` : ''}
      </div>`,
      venueName: venue.name,
      logoUrl: venueLogoAbsoluteUrl(venue),
    });
  }

  /**
   * Due casi distinti sotto lo stesso endpoint: (1) il dipendente annulla da
   * sé una **propria** richiesta — a qualunque stato tranne REJECTED (già
   * decisa, non c'è nulla da annullare), inclusa una già approvata (i piani
   * possono cambiare) — e in tal caso l'email del locale ne viene informata
   * (sotto); (2) admin/responsabile cancellano una richiesta **approvata**
   * di un altro dipendente, come già prima di questo cambiamento (es. per
   * correggere un errore). Le richieste non ancora approvate di un altro
   * dipendente si gestiscono con review() (approva/rifiuta), non con la
   * cancellazione.
   */
  async remove(user: AuthenticatedUser, requestId: string) {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: { employee: true },
    });
    if (!request || request.employee.venueId !== requireVenueId(user)) {
      throw new NotFoundException('Richiesta non trovata');
    }

    const isOwnRequest = request.employee.userId === user.userId;

    if (isOwnRequest) {
      if (request.status === 'REJECTED') {
        throw new BadRequestException('Una richiesta già rifiutata non può essere annullata.');
      }
    } else {
      if (request.status !== 'APPROVED') {
        throw new BadRequestException('Solo le richieste approvate possono essere eliminate.');
      }
      await this.assertCanManage(user);
    }

    await this.prisma.leaveRequest.delete({ where: { id: requestId } });

    await this.audit.log({
      venueId: requireVenueId(user),
      userId: user.userId,
      entity: 'LeaveRequest',
      entityId: requestId,
      action: 'DELETE',
      before: request,
    });

    if (isOwnRequest) {
      await this.notifyVenueOfCancellation(requireVenueId(user), request);
    }

    return { success: true };
  }

  /**
   * Simmetrica a `notifyVenueByEmail` (nuova richiesta): quando è il
   * dipendente stesso ad annullare, l'email del locale (non quella di login
   * del singolo utente, v. §5.9) ne viene informata, così l'amministratore
   * non scopre la cancellazione solo aprendo l'app.
   */
  private async notifyVenueOfCancellation(
    venueId: string,
    request: {
      type: string;
      status: string;
      startDate: Date;
      endDate: Date;
      employee: { firstName: string; lastName: string };
    },
  ): Promise<void> {
    const venue = await this.prisma.venue.findUnique({
      where: { id: venueId },
      select: { email: true, name: true, slug: true, logoUrl: true },
    });
    if (!venue?.email) return;

    const typeLabel = typeLabels[request.type] ?? request.type;
    const when = `${request.startDate.toLocaleDateString('it-IT')} — ${request.endDate.toLocaleDateString('it-IT')}`;
    const wasApprovedNote = request.status === 'APPROVED' ? ' (era già approvata)' : '';

    await this.mail.send({
      to: venue.email,
      subject: `Richiesta di ${typeLabel.toLowerCase()} annullata — ${request.employee.firstName} ${request.employee.lastName}`,
      text: `${request.employee.firstName} ${request.employee.lastName} ha annullato la propria richiesta di ${typeLabel.toLowerCase()} per il periodo ${when}${wasApprovedNote}.`,
      html: `<div style="font-family:sans-serif;color:#222;">
        <h2>Richiesta annullata dal dipendente</h2>
        <p><strong>${escapeHtml(request.employee.firstName)} ${escapeHtml(request.employee.lastName)}</strong> ha annullato la propria richiesta di ${escapeHtml(typeLabel.toLowerCase())} per il periodo ${escapeHtml(when)}${escapeHtml(wasApprovedNote)}.</p>
      </div>`,
      venueName: venue.name,
      logoUrl: venueLogoAbsoluteUrl(venue),
    });
  }

  /** Richieste approvate del locale, per chi può eliminarle (admin o responsabile). */
  async listApprovedForManager(user: AuthenticatedUser) {
    await this.assertCanManage(user);
    const requests = await this.prisma.leaveRequest.findMany({
      where: { employee: { venueId: requireVenueId(user) }, status: 'APPROVED' },
      include: { employee: true },
      orderBy: { startDate: 'desc' },
    });
    return this.annotateOverlaps(requests);
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
