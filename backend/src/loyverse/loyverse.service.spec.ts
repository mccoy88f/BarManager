import { BadRequestException } from '@nestjs/common';
import { LoyverseService } from './loyverse.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoyverseSyncService } from './loyverse-sync.service';
import { encryptSecret } from '../common/crypto/secret-crypto';

describe('LoyverseService', () => {
  let prisma: {
    venue: { findUnique: jest.Mock; update: jest.Mock };
    menuItem: { deleteMany: jest.Mock };
    menuCategory: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: LoyverseService;

  beforeEach(() => {
    process.env.SECRET_ENCRYPTION_KEY = 'test-key';
    prisma = {
      venue: { findUnique: jest.fn(), update: jest.fn() },
      menuItem: { deleteMany: jest.fn() },
      menuCategory: { deleteMany: jest.fn() },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    service = new LoyverseService(prisma as unknown as PrismaService, {} as LoyverseSyncService);
  });

  it('svuota il menù del locale quando l\'integrazione viene attivata', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: false,
      loyverseAccessTokenEnc: encryptSecret('token-esistente'),
    });

    await service.updateSettings('venue-1', { enabled: true });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.menuItem.deleteMany).toHaveBeenCalledWith({ where: { venueId: 'venue-1' } });
    expect(prisma.menuCategory.deleteMany).toHaveBeenCalledWith({ where: { venueId: 'venue-1' } });
    expect(prisma.venue.update).toHaveBeenCalledWith({
      where: { id: 'venue-1' },
      data: { loyverseIntegrationEnabled: true },
    });
  });

  it('svuota il menù del locale quando l\'integrazione viene disattivata', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-esistente'),
    });

    await service.updateSettings('venue-1', { enabled: false });

    expect(prisma.menuItem.deleteMany).toHaveBeenCalledWith({ where: { venueId: 'venue-1' } });
    expect(prisma.menuCategory.deleteMany).toHaveBeenCalledWith({ where: { venueId: 'venue-1' } });
    expect(prisma.venue.update).toHaveBeenCalledWith({
      where: { id: 'venue-1' },
      data: { loyverseIntegrationEnabled: false },
    });
  });

  it('non tocca il menù quando si salva solo il token, senza cambiare enabled', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: false,
      loyverseAccessTokenEnc: null,
    });

    await service.updateSettings('venue-1', { accessToken: 'nuovo-token' });

    expect(prisma.menuItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.menuCategory.deleteMany).not.toHaveBeenCalled();
    expect(prisma.venue.update).toHaveBeenCalledWith({
      where: { id: 'venue-1' },
      data: { loyverseAccessTokenEnc: expect.any(String) },
    });
  });

  it('non tocca il menù quando "enabled" resta invariato', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: true,
      loyverseAccessTokenEnc: encryptSecret('token-esistente'),
    });

    await service.updateSettings('venue-1', { enabled: true });

    expect(prisma.menuItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.menuCategory.deleteMany).not.toHaveBeenCalled();
  });

  it('rifiuta l\'attivazione senza un token già impostato, senza svuotare nulla', async () => {
    prisma.venue.findUnique.mockResolvedValue({
      id: 'venue-1',
      loyverseIntegrationEnabled: false,
      loyverseAccessTokenEnc: null,
    });

    await expect(service.updateSettings('venue-1', { enabled: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.menuItem.deleteMany).not.toHaveBeenCalled();
    expect(prisma.venue.update).not.toHaveBeenCalled();
  });
});
