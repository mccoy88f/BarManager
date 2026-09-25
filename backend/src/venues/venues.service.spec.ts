import { VenuesService } from './venues.service';
import { PrismaService } from '../prisma/prisma.service';

describe('VenuesService', () => {
  let prisma: { venue: { findUnique: jest.Mock } };
  let service: VenuesService;

  beforeEach(() => {
    prisma = { venue: { findUnique: jest.fn() } };
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
});
