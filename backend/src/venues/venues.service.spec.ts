import { NotFoundException } from '@nestjs/common';
import { VenuesService } from './venues.service';
import { PrismaService } from '../prisma/prisma.service';

describe('VenuesService', () => {
  let prisma: {
    venue: { findUnique: jest.Mock; update: jest.Mock };
    venueSpecialDay: { findMany: jest.Mock; findUnique: jest.Mock; upsert: jest.Mock; delete: jest.Mock };
  };
  let service: VenuesService;

  beforeEach(() => {
    prisma = {
      venue: { findUnique: jest.fn(), update: jest.fn() },
      venueSpecialDay: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new VenuesService(prisma as unknown as PrismaService);
  });

  describe('getOwn', () => {
    /**
     * `sumupApiKeyEnc` va selezionato per calcolare `sumupHasApiKey`, ma è
     * una credenziale cifrata: non deve mai arrivare al frontend, nemmeno
     * cifrata. Una regressione qui (es. uno spread `{...venue}` che la
     * riporti dentro) esporrebbe la chiave SumUp del locale al client.
     */
    it('non include mai sumupApiKeyEnc nella risposta, ma calcola sumupHasApiKey', async () => {
      prisma.venue.findUnique.mockResolvedValue({
        id: 'venue-1',
        name: 'Bar Test',
        openingHours: null,
        onlineOrdersOpeningHours: null,
        sumupApiKeyEnc: 'cifrato-segreto',
        sumupEnabled: true,
      });

      const result = await service.getOwn('venue-1');

      expect(result).not.toHaveProperty('sumupApiKeyEnc');
      expect((result as unknown as { sumupHasApiKey: boolean }).sumupHasApiKey).toBe(true);
    });

    it('sumupHasApiKey è false quando nessuna chiave è impostata', async () => {
      prisma.venue.findUnique.mockResolvedValue({
        id: 'venue-1',
        name: 'Bar Test',
        openingHours: null,
        onlineOrdersOpeningHours: null,
        sumupApiKeyEnc: null,
        sumupEnabled: false,
      });

      const result = await service.getOwn('venue-1');

      expect((result as unknown as { sumupHasApiKey: boolean }).sumupHasApiKey).toBe(false);
    });
  });

  describe('updateMenuHours (§5.10: orari pranzo/cena del menù, decoupled da openingHours)', () => {
    it('scrive su menuMealPeriodsHours, non su openingHours', async () => {
      const days = [{ dayOfWeek: 1, closed: false, slot1Start: '12:00', slot1End: '15:00', slot2Start: null, slot2End: null }];
      await service.updateMenuHours('venue-1', { days } as never);
      expect(prisma.venue.update).toHaveBeenCalledWith({
        where: { id: 'venue-1' },
        data: { menuMealPeriodsHours: days },
      });
    });
  });

  describe('aperture speciali (VenueSpecialDay, §5.10)', () => {
    it('listSpecialDays: elenca le aperture speciali del locale ordinate per data', async () => {
      prisma.venueSpecialDay.findMany.mockResolvedValue([{ id: 'sd-1' }]);
      const result = await service.listSpecialDays('venue-1');
      expect(prisma.venueSpecialDay.findMany).toHaveBeenCalledWith({
        where: { venueId: 'venue-1' },
        orderBy: { date: 'asc' },
      });
      expect(result).toEqual([{ id: 'sd-1' }]);
    });

    it('upsertSpecialDay: crea/aggiorna con la chiave data + venueId, entrambi gli override indipendenti', async () => {
      await service.upsertSpecialDay('venue-1', {
        date: '2024-12-24',
        label: 'Vigilia di Natale',
        realHoursOverride: { closed: false, slot1Start: '18:00', slot1End: '23:59', slot2Start: null, slot2End: null },
        menuHoursOverride: null,
      });
      expect(prisma.venueSpecialDay.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { venueId_date: { venueId: 'venue-1', date: new Date('2024-12-24T00:00:00.000Z') } },
        }),
      );
      const call = prisma.venueSpecialDay.upsert.mock.calls[0][0];
      expect(call.create.label).toBe('Vigilia di Natale');
      expect(call.create.realHoursOverride).toEqual({ closed: false, slot1Start: '18:00', slot1End: '23:59', slot2Start: null, slot2End: null });
      expect(call.create.menuHoursOverride).toBeNull();
    });

    it('removeSpecialDay: rifiuta se l\'apertura speciale non è di questo locale', async () => {
      prisma.venueSpecialDay.findUnique.mockResolvedValue({ id: 'sd-1', venueId: 'altro-venue' });
      await expect(service.removeSpecialDay('venue-1', 'sd-1')).rejects.toThrow(NotFoundException);
      expect(prisma.venueSpecialDay.delete).not.toHaveBeenCalled();
    });

    it('removeSpecialDay: elimina se appartiene al locale', async () => {
      prisma.venueSpecialDay.findUnique.mockResolvedValue({ id: 'sd-1', venueId: 'venue-1' });
      const result = await service.removeSpecialDay('venue-1', 'sd-1');
      expect(prisma.venueSpecialDay.delete).toHaveBeenCalledWith({ where: { id: 'sd-1' } });
      expect(result).toEqual({ success: true });
    });
  });
});
