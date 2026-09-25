import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VenuesService } from './venues.service';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-crypto';
import { SumUpApiError, sumupClient } from '../common/payments/sumup-client';

jest.mock('../common/payments/sumup-client', () => ({
  ...jest.requireActual('../common/payments/sumup-client'),
  sumupClient: {
    createCheckout: jest.fn(),
    getCheckout: jest.fn(),
    verifyApiKey: jest.fn(),
    refund: jest.fn(),
  },
}));

// Va impostata subito, prima che eventuali fixture valutate in fase di
// collection dei test chiamino encryptSecret — altrimenti cifrano con una
// chiave diversa da quella con cui i test poi decifrano.
process.env.SECRET_ENCRYPTION_KEY = 'test-key';

describe('VenuesService', () => {
  let prisma: {
    venue: { findUnique: jest.Mock; update: jest.Mock };
    venueSpecialDay: { findMany: jest.Mock; findUnique: jest.Mock; upsert: jest.Mock; delete: jest.Mock };
  };
  let service: VenuesService;

  beforeEach(() => {
    jest.clearAllMocks();
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

  describe('updateSumUpSettings (sanificazione API key)', () => {
    /**
     * Il campo è type="password" (valore mascherato in UI) e le pagine
     * SumUp mostrano la chiave dentro esempi come "Authorization: Bearer
     * sup_sk_...": uno spazio/a capo incollato per errore o la parola
     * "Bearer" copiata insieme alla chiave fanno fallire con 401 la
     * chiamata a SumUp anche con la chiave "giusta" — va tolto prima di
     * cifrare, non lasciato all'admin da scoprire a occhio.
     */
    it('rimuove spazi/a capo attorno alla chiave prima di cifrarla', async () => {
      prisma.venue.findUnique.mockResolvedValue({ id: 'venue-1', sumupApiKeyEnc: null, sumupEnabled: false });
      await service.updateSumUpSettings('venue-1', { apiKey: '  sup_sk_test123  \n' });
      const savedEnc = prisma.venue.update.mock.calls[0][0].data.sumupApiKeyEnc;
      expect(decryptSecret(savedEnc)).toBe('sup_sk_test123');
    });

    it('rimuove un prefisso "Bearer " copiato per errore insieme alla chiave', async () => {
      prisma.venue.findUnique.mockResolvedValue({ id: 'venue-1', sumupApiKeyEnc: null, sumupEnabled: false });
      await service.updateSumUpSettings('venue-1', { apiKey: 'Bearer sup_sk_test123' });
      const savedEnc = prisma.venue.update.mock.calls[0][0].data.sumupApiKeyEnc;
      expect(decryptSecret(savedEnc)).toBe('sup_sk_test123');
    });
  });

  describe('verifySumUpApiKey', () => {
    /**
     * Bug riportato: un SumUpApiError (es. API key non valida, 401) non
     * tradotto risaliva come 500 Internal Server Error generico invece di
     * un 400 con un messaggio leggibile per l'admin.
     */
    it('traduce un SumUpApiError in BadRequestException con il messaggio originale, invece di un 500 generico', async () => {
      prisma.venue.findUnique.mockResolvedValue({ id: 'venue-1', sumupApiKeyEnc: encryptSecret('sumup-key') });
      (sumupClient.verifyApiKey as jest.Mock).mockRejectedValue(
        new SumUpApiError('API key SumUp non valida o senza i permessi necessari.', 401),
      );

      await expect(service.verifySumUpApiKey('venue-1')).rejects.toThrow(BadRequestException);
      await expect(service.verifySumUpApiKey('venue-1')).rejects.toThrow(
        'API key SumUp non valida o senza i permessi necessari.',
      );
    });

    it('rilancia un errore non-SumUpApiError inalterato', async () => {
      prisma.venue.findUnique.mockResolvedValue({ id: 'venue-1', sumupApiKeyEnc: encryptSecret('sumup-key') });
      (sumupClient.verifyApiKey as jest.Mock).mockRejectedValue(new Error('errore imprevisto'));

      await expect(service.verifySumUpApiKey('venue-1')).rejects.toThrow('errore imprevisto');
    });

    it('rifiuta con BadRequestException se nessuna API key è impostata', async () => {
      prisma.venue.findUnique.mockResolvedValue({ id: 'venue-1', sumupApiKeyEnc: null });

      await expect(service.verifySumUpApiKey('venue-1')).rejects.toThrow(BadRequestException);
      expect(sumupClient.verifyApiKey).not.toHaveBeenCalled();
    });

    it('risolve con { valid: true } quando la chiave funziona', async () => {
      prisma.venue.findUnique.mockResolvedValue({ id: 'venue-1', sumupApiKeyEnc: encryptSecret('sumup-key') });
      (sumupClient.verifyApiKey as jest.Mock).mockResolvedValue(undefined);

      await expect(service.verifySumUpApiKey('venue-1')).resolves.toEqual({ valid: true });
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
