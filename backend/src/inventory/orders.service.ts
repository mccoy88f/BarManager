import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { CreateOrderDto, OrderLineInput } from './dto/create-order.dto';
import { CreateOrdersByCategoryDto } from './dto/create-orders-by-category.dto';
import { MailService } from './mail.service';
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
    private pdf: PdfService,
  ) {}

  /** Crea un nuovo ordine (bozza) calcolando le quantità da ordinare. */
  async createOrder(user: AuthenticatedUser, dto: CreateOrderDto) {
    const venueId = requireVenueId(user);
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier || supplier.venueId !== venueId) {
      throw new NotFoundException('Fornitore non trovato');
    }
    return this.createOrderForSupplier(user, venueId, dto.supplierId, dto.lines);
  }

  /**
   * Un ordine "per categoria" raccoglie prodotti di quella categoria che
   * possono appartenere a fornitori diversi: qui si dividono le righe per
   * fornitore e si crea un ordine (bozza) per ciascuno, esattamente come se
   * fossero stati creati uno alla volta con createOrder.
   */
  async createOrdersByCategory(user: AuthenticatedUser, dto: CreateOrdersByCategoryDto) {
    const venueId = requireVenueId(user);
    const category = await this.prisma.productCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category || category.venueId !== venueId) {
      throw new NotFoundException('Categoria non trovata');
    }

    const productIds = dto.lines.map((l) => l.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, categoryId: dto.categoryId },
    });
    const productSupplierOf = new Map(products.map((p) => [p.id, p.supplierId]));

    const linesBySupplier = new Map<string, OrderLineInput[]>();
    for (const line of dto.lines) {
      const supplierId = productSupplierOf.get(line.productId);
      if (!supplierId) continue; // prodotto non trovato o di un'altra categoria: ignorato
      const bucket = linesBySupplier.get(supplierId) ?? [];
      bucket.push(line);
      linesBySupplier.set(supplierId, bucket);
    }
    if (linesBySupplier.size === 0) {
      throw new BadRequestException('Nessun prodotto valido per questa categoria');
    }

    const orders = [];
    for (const [supplierId, lines] of linesBySupplier) {
      orders.push(await this.createOrderForSupplier(user, venueId, supplierId, lines));
    }
    return orders;
  }

  private async createOrderForSupplier(
    user: AuthenticatedUser,
    venueId: string,
    supplierId: string,
    lines: OrderLineInput[],
  ) {
    const productIds = lines.map((l) => l.productId);
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
        supplierId,
        createdById: user.userId,
        lines: {
          create: lines.map((line) => {
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
   * più fatta da qui: il frontend, dopo l'invio, scarica lo stesso PDF di
   * exportPdf e lo condivide con l'app di stampa (v.
   * frontend/src/printing/printJob.ts).
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
   * Invia più ordini in sequenza (uno per fornitore, dopo una creazione
   * "per categoria"): un fornitore il cui invio fallisce non blocca gli
   * altri, l'esito di ciascuno è riportato separatamente.
   */
  async sendOrders(user: AuthenticatedUser, orderIds: string[]) {
    const results = [];
    for (const orderId of orderIds) {
      try {
        const { order, email } = await this.sendOrder(user, orderId);
        results.push({ orderId, supplierName: order.supplier.name, sent: true, email });
      } catch (err) {
        results.push({
          orderId,
          supplierName: null,
          sent: false,
          error: err instanceof Error ? err.message : 'Invio fallito',
        });
      }
    }
    return results;
  }

  /**
   * Righe/piè di pagina della checklist POS: condiviso tra l'invio
   * dell'ordine, una ristampa richiesta più avanti dallo storico e
   * l'esportazione PDF (stesso identico contenuto testuale, così un
   * domani la stampa diretta su POS può riusarlo senza modifiche).
   */
  private buildPrintPayload(order: OrderWithDetails) {
    const onlyOrdered = order.lines.filter((l) => l.orderedQty > 0);

    const header = [
      `Data: ${order.createdAt.toLocaleDateString('it-IT')}`,
      ...(order.sentAt ? [`Inviato: ${order.sentAt.toLocaleDateString('it-IT')}`] : []),
      `Autore: ${order.createdBy.email}`,
      '',
    ];

    // Se il prodotto ha un costo unitario impostato, la riga mostra anche
    // prezzo x colli ordinati = subtotale, e in fondo compare il totale.
    const productLines = onlyOrdered.map((l) => {
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

    return { title: `Ordine ${order.supplier.name}`, lines: [...header, ...productLines], footer };
  }

  /** PDF di un singolo ordine, largo come uno scontrino: stesso PDF sia per l'esportazione che per la ristampa. */
  async exportPdf(venueId: string, orderId: string): Promise<Buffer> {
    const order = await this.getOrder(venueId, orderId);
    return this.pdf.buildReceiptDocument([this.buildPrintPayload(order)]);
  }

  /**
   * PDF di più ordini (uno per fornitore, dopo una creazione "per
   * categoria"), con una pagina separata per ciascuno, stesso formato a
   * scontrino del singolo ordine.
   */
  async exportBatchPdf(venueId: string, orderIds: string[]): Promise<Buffer> {
    const orders = await Promise.all(orderIds.map((id) => this.getOrder(venueId, id)));
    return this.pdf.buildReceiptDocument(orders.map((order) => this.buildPrintPayload(order)));
  }
}
