import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSecret } from '../common/crypto/secret-crypto';
import { UpdateLoyverseSettingsDto } from './dto/update-loyverse-settings.dto';
import { LoyverseSyncService } from './loyverse-sync.service';

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
    };
  }

  async updateSettings(venueId: string, dto: UpdateLoyverseSettingsDto) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Locale non trovato');

    const data: { loyverseAccessTokenEnc?: string | null; loyverseIntegrationEnabled?: boolean } = {};

    if (dto.accessToken !== undefined) {
      data.loyverseAccessTokenEnc = dto.accessToken ? encryptSecret(dto.accessToken) : null;
    }

    if (dto.enabled !== undefined) {
      const willHaveToken = dto.accessToken ? true : !!venue.loyverseAccessTokenEnc;
      if (dto.enabled && !willHaveToken) {
        throw new BadRequestException('Imposta prima un token di accesso Loyverse valido.');
      }
      data.loyverseIntegrationEnabled = dto.enabled;
    }

    await this.prisma.venue.update({ where: { id: venueId }, data });
    return this.getStatus(venueId);
  }

  syncNow(venueId: string) {
    return this.syncService.sync(venueId);
  }
}
