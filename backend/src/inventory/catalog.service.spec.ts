import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CatalogService.createProduct — isolamento tenant', () => {
  let prisma: {
    productCategory: { findUnique: jest.Mock };
    supplier: { findUnique: jest.Mock };
    product: { create: jest.Mock };
  };
  let service: CatalogService;

  const dto = {
    name: 'Birra 33cl',
    unit: 'pz',
    standardQty: 24,
    categoryId: 'cat-1',
    supplierId: 'sup-1',
  };

  beforeEach(() => {
    prisma = {
      productCategory: { findUnique: jest.fn() },
      supplier: { findUnique: jest.fn() },
      product: { create: jest.fn() },
    };
    service = new CatalogService(prisma as unknown as PrismaService);
  });

  it('crea il prodotto quando categoria e fornitore sono del locale corretto', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-1' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-1' });
    prisma.product.create.mockResolvedValue({ id: 'prod-1', ...dto });

    await expect(service.createProduct('venue-1', dto)).resolves.toEqual({
      id: 'prod-1',
      ...dto,
    });
  });

  it('rifiuta una categoria di un altro locale (indovinata via id)', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-2' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-1' });

    await expect(service.createProduct('venue-1', dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('rifiuta un fornitore di un altro locale (indovinato via id)', async () => {
    prisma.productCategory.findUnique.mockResolvedValue({ id: 'cat-1', venueId: 'venue-1' });
    prisma.supplier.findUnique.mockResolvedValue({ id: 'sup-1', venueId: 'venue-2' });

    await expect(service.createProduct('venue-1', dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});
