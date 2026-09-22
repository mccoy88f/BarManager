import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PrinterUsage, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { CreateOrderDto } from './dto/create-order.dto';
import { MailService } from './mail.service';
import { PrintingService } from '../printing/printing.service';
import { PdfService } from '../reports/pdf.service';

const ORDER_INCLUDE = {
  lines: { include: { product: true } },
  supplier: true,
  createdBy: { select: { email: true } },
} as const;

type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private mail: MailService,
    private printing: PrintingService,
    private pdf: PdfService,
  ) {}

  /** Crea un nuovo ordine (bozza) calcolando le quantità da ordinare. */
  async createOrder(user: AuthenticatedUser, dto: CreateOrderDto) {
    const venueId = requireVenueId(user);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier || supplier.venueId !== venueId) {
      throw new NotFoundException('Fornitore non trovato');
    }

    const productIds = dto.lines.map((l) => l.productId);
    // include category per verificare che ogni prodotto appartenga al locale
    // di chi chiama: senza questo controllo, un id di prodotto di un altro
    // locale (indovinato) finirebbe comunque nell'ordine.
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { category: true },
    });
    const productMap = new Map(
      products.filter((p) => p.category.venueId === venueId).map((p) => [p.id, p]),
    );

    const order = await this.prisma.order.create({
      data: {
        venueId,
        supplierId: dto.supplierId,
        createdById: user.userId,
        lines: {
          create: dto.lines.map((line) => {
            const product = productMap.get(line.productId);
            if (!product) throw new BadRequestException(`Prodotto ${line.productId} non trovato`);
            const suggestedQty = Math.max(0, product.standardQty - line.stockOnHand);
            return {
              productId: line.productId,
              stockOnHand: line.stockOnHand,
              suggestedQty,
              orderedQty: suggestedQty,
            };
          }),
        },
      },
      include: ORDER_INCLUDE,
    });

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'Order',
      entityId: order.id,
      action: 'CREATE',
      after: order,
    });

    return order;
  }

  async updateLineQty(venueId: string, orderId: string, lineId: string, orderedQty: number) {
    const line = await this.prisma.orderLine.findUnique({
      where: { id: lineId },
      include: { order: true },
    });
    if (!line || line.orderId !== orderId || line.order.venueId !== venueId) {
      throw new NotFoundException('Riga ordine non trovata');
    }
    return this.prisma.orderLine.update({ where: { id: lineId }, data: { orderedQty } });
  }

  async getOrder(venueId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!order || order.venueId !== venueId) throw new NotFoundException('Ordine non trovato');
    return order;
  }

  /** Storico ordini: righe incluse per calcolare il totale (se i prodotti hanno un costo). */
  listOrders(venueId: string) {
    return this.prisma.order.findMany({
      where: { venueId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Conferma e invia l'ordine: email al fornitore (in CC i responsabili di
   * reparto/categoria configurati). La stampa della checklist POS non è
   * più fatta da qui: il frontend, dopo l'invio, prepara e invia il
   * lavoro di stampa dal browser (v. buildPrintJob e
   * frontend/src/printing/qzPrint.ts).
   */
  async sendOrder(user: AuthenticatedUser, orderId: string) {
    const venueId = requireVenueId(user);
    const order = await this.getOrder(venueId, orderId);
    if (order.status !== OrderStatus.DRAFT) {
      throw new BadRequestException('Ordine già inviato');
    }

    const onlyOrdered = order.lines.filter((l) => l.orderedQty > 0);

    // Responsabili di reparto/categoria da mettere in CC
    const managers = await this.prisma.employee.findMany({
      where: { venueId, isManager: true, active: true },
      include: { user: { select: { email: true } } },
    });
    const managerEmails = managers
      .map((m) => m.email ?? m.user?.email)
      .filter((e): e is string => !!e);
    const cc = [...new Set([...order.supplier.ccEmails, ...managerEmails])];

    const bodyLines = onlyOrdered.map(
      (l) => `- ${l.product.name}: ${l.orderedQty} ${l.product.unit}`,
    );
    const emailResult = await this.mail.sendOrderEmail({
      to: order.supplier.email,
      cc,
      subject: `Ordine BarManager — ${new Date().toLocaleDateString('it-IT')}`,
      text: `Buongiorno,\n\nsi richiede l'invio dei seguenti prodotti:\n\n${bodyLines.join('\n')}\n\nGrazie.`,
    });

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.SENT, sentAt: new Date() },
      include: ORDER_INCLUDE,
    });

    await this.audit.log({
      venueId,
      userId: user.userId,
      entity: 'Order',
      entityId: orderId,
      action: 'UPDATE',
      before: order,
      after: updated,
    });

    return { order: updated, email: emailResult };
  }

  /**
   * Righe/piè di pagina della checklist POS: condiviso tra l'invio
   * dell'ordine e una ristampa richiesta più avanti dallo storico.
   */
  private buildPrintPayload(order: OrderWithDetails) {
    const onlyOrdered = order.lines.filter((l) => l.orderedQty > 0);

    // Se il prodotto ha un costo unitario impostato, la riga mostra anche
    // prezzo x colli ordinati = subtotale, e in fondo compare il totale.
    const lines = onlyOrdered.map((l) => {
      const base = `${l.product.name.padEnd(24)} x ${l.orderedQty} ${l.product.unit}`;
      if (l.product.costPerUnit == null) return base;
      const lineTotal = l.product.costPerUnit * l.orderedQty;
      return `${base}  €${l.product.costPerUnit.toFixed(2)} = €${lineTotal.toFixed(2)}`;
    });
    const grandTotal = onlyOrdered.reduce(
      (sum, l) => sum + (l.product.costPerUnit ?? 0) * l.orderedQty,
      0,
    );
    const footer =
      grandTotal > 0
        ? ['Checklist per controllo scarico merce ->', '', `TOTALE: €${grandTotal.toFixed(2)}`]
        : ['Checklist per controllo scarico merce ->'];

    return { title: `Ordine ${order.supplier.name}`, lines, footer };
  }

  /**
   * Prepara la checklist ordine per la stampa (all'invio o su richiesta
   * dallo storico, in qualsiasi momento dopo l'invio): il browser la
   * inoltra poi alla stampante via QZ Tray.
   */
  async buildPrintJob(venueId: string, orderId: string) {
    const order = await this.getOrder(venueId, orderId);
    return this.printing.buildReportJob(venueId, PrinterUsage.ORDERS, this.buildPrintPayload(order));
  }

  /** PDF dell'ordine: fornitore, data, autore, righe con importi singoli e totale. */
  async exportPdf(venueId: string, orderId: string): Promise<Buffer> {
    const order = await this.getOrder(venueId, orderId);
    const onlyOrdered = order.lines.filter((l) => l.orderedQty > 0);
    const grandTotal = onlyOrdered.reduce(
      (sum, l) => sum + (l.product.costPerUnit ?? 0) * l.orderedQty,
      0,
    );

    return this.pdf.buildDocument((doc) => {
      doc.fontSize(16).text('Ordine fornitore', { align: 'center' }).moveDown();

      doc.fontSize(11);
      doc.text(`Fornitore: ${order.supplier.name}`);
      doc.text(`Data ordine: ${order.createdAt.toLocaleDateString('it-IT')}`);
      if (order.sentAt) doc.text(`Inviato il: ${order.sentAt.toLocaleDateString('it-IT')}`);
      doc.text(`Autore: ${order.createdBy.email}`);
      doc.moveDown();

      doc.fontSize(10);
      for (const line of onlyOrdered) {
        const amount =
          line.product.costPerUnit != null
            ? `€ ${line.product.costPerUnit.toFixed(2)} = € ${(line.product.costPerUnit * line.orderedQty).toFixed(2)}`
            : '—';
        doc.text(
          `${line.product.name.padEnd(28)} ${String(line.orderedQty).padStart(6)} ${line.product.unit.padEnd(6)} ${amount}`,
        );
      }

      if (grandTotal > 0) {
        doc.moveDown().fontSize(12).text(`Totale: € ${grandTotal.toFixed(2)}`, { align: 'right' });
      }
    });
  }
}
