import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSecret } from '../common/crypto/secret-crypto';
import { UpdateLoyverseSettingsDto } from './dto/update-loyverse-settings.dto';
import { LoyverseSyncService, LoyverseSyncSummary } from './loyverse-sync.service';

@Injectable()
export class LoyverseService {
  constructor(
    private prisma: PrismaService,
    private syncService: LoyverseSyncService,
  ) {}

  async getStatus(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Locale non trovato');
    return {
      enabled: venue.loyverseIntegrationEnabled,
      hasToken: !!venue.loyverseAccessTokenEnc,
      lastSyncAt: venue.loyverseLastSyncAt,
      lastSyncError: venue.loyverseLastSyncError,
      lastSyncSummary: venue.loyverseLastSyncSummary as unknown as LoyverseSyncSummary | null,
    };
  }

  /**
   * All'attivazione, il menù precedente (creato a mano) non ha senso restare
   * misto a quello che arriverà da Loyverse; alla disattivazione, il menù
   * sincronizzato da Loyverse non è più aggiornabile da lì. In entrambi i
   * casi ripartiamo da un menù vuoto — l'utente viene avvisato e deve
   * confermare lato UI prima che questa chiamata parta (v. VenueSettings.tsx).
   */
  private wipeMenu(venueId: string) {
    return [
      this.prisma.menuItem.deleteMany({ where: { venueId } }), // MenuItemVariant a cascata
      this.prisma.menuCategory.deleteMany({ where: { venueId } }),
    ];
  }

  async updateSettings(venueId: string, dto: UpdateLoyverseSettingsDto) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Locale non trovato');

    const data: { loyverseAccessTokenEnc?: string | null; loyverseIntegrationEnabled?: boolean } = {};

    if (dto.accessToken !== undefined) {
      data.loyverseAccessTokenEnc = dto.accessToken ? encryptSecret(dto.accessToken) : null;
    }

    let togglesIntegration = false;
    if (dto.enabled !== undefined) {
      const willHaveToken = dto.accessToken ? true : !!venue.loyverseAccessTokenEnc;
      if (dto.enabled && !willHaveToken) {
        throw new BadRequestException('Imposta prima un token di accesso Loyverse valido.');
      }
      data.loyverseIntegrationEnabled = dto.enabled;
      togglesIntegration = dto.enabled !== venue.loyverseIntegrationEnabled;
    }

    if (togglesIntegration) {
      await this.prisma.$transaction([
        ...this.wipeMenu(venueId),
        this.prisma.venue.update({ where: { id: venueId }, data }),
      ]);
    } else {
      await this.prisma.venue.update({ where: { id: venueId }, data });
    }

    return this.getStatus(venueId);
  }

  syncNow(venueId: string) {
    return this.syncService.sync(venueId);
  }
}
