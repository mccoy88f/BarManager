import { NotFoundException } from '@nestjs/common';
import { LoyverseSyncService } from './loyverse-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSecret } from '../common/crypto/secret-crypto';
import { loyverseClient } from './loyverse-client';

jest.mock('./loyverse-client', () => ({
  loyverseClient: {
    listCategories: jest.fn(),
    listItems: jest.fn(),
    extractImageUrl: jest.fn(() => undefined),
  },
  LoyverseApiError: class LoyverseApiError extends Error {},
}));

describe('LoyverseSyncService', () => {
  let prisma: {
    venue: { findUnique: jest.Mock; update: jest.Mock };
    menuCategory: { findMany: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock };
    menuItem: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock; count: jest.Mock };
    menuItemVariant: { create: jest.Mock; update: jest.Mock };
  };
  let service: LoyverseSyncService;

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = 'test-key';
    prisma = {
      venue: { findUnique: jest.fn(), update: jest.fn() },
      menuCategory: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      menuItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      menuItemVariant: { create: jest.fn(), update: jest.fn() },
    };
    service = new LoyverseSyncService(prisma as unknown as PrismaService);
    jest.clearAllMocks();
    (loyverseClient.extractImageUrl as jest.Mock).mockReturnValue(undefined);
  });

  it('rifiuta il sync se l\'integrazione non è attiva o non ha un token', async () => {
    prisma.venue.findUnique.mockResolvedValue({ loyverseIntegrationEnabled: false });
    await expect(service.sync('venue-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('crea categoria e voce di menù (con variante) da un item Loyverse senza corrispondenza locale', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([{ id: 'cat-ext-1', name: 'Bevande' }]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      {
        id: 'item-ext-1',
        item_name: 'Birra',
        category_id: 'cat-ext-1',
        variants: [{ variant_id: 'var-ext-1', default_price: 4.5 }],
      },
    ]);
    prisma.menuCategory.create.mockResolvedValue({ id: 'cat-local-1' });
    prisma.menuItem.create.mockResolvedValue({ id: 'item-local-1' });

    const summary = await service.sync('venue-1');

    expect(prisma.menuCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Bevande', loyverseCategoryId: 'cat-ext-1' }),
      }),
    );
    expect(prisma.menuItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Birra',
          loyverseItemId: 'item-ext-1',
          categoryId: 'cat-local-1',
          visible: false,
        }),
      }),
    );
    expect(prisma.menuItemVariant.create).toHaveBeenCalledWith({
      data: { name: '', price: 4.5, sortOrder: 0, menuItemId: 'item-local-1', loyverseVariantId: 'var-ext-1' },
    });
    expect(summary.categories).toBe(1);
    expect(summary.items).toBe(1);
    expect(prisma.venue.update).toHaveBeenCalledWith({
      where: { id: 'venue-1' },
      data: { loyverseLastSyncAt: expect.any(Date), loyverseLastSyncError: null },
    });
  });

  it('salta una voce Loyverse la cui categoria non è mappata, senza far fallire il sync', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-123'),
    });
    (loyverseClient.listCategories as jest.Mock).mockResolvedValue([]);
    (loyverseClient.listItems as jest.Mock).mockResolvedValue([
      { id: 'item-ext-1', item_name: 'Orfano', category_id: 'cat-mai-vista', variants: [] },
    ]);

    const summary = await service.sync('venue-1');

    expect(prisma.menuItem.create).not.toHaveBeenCalled();
    expect(summary.items).toBe(1);
  });
});
