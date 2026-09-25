import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { OnlineOrdersSlotMode } from '@prisma/client';

/** Impostazioni del modulo Ordini online (§5.10): interruttori, consegna, accettazione automatica, mappatura Loyverse. */
export class UpdateOnlineOrdersSettingsDto {
  @IsOptional()
  @IsBoolean()
  onlineOrdersEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  onlineOrdersPickupEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  onlineOrdersDeliveryEnabled?: boolean;

  /** Anticipo minimo (minuti da adesso) richiesto dal checkout pubblico. */
  @IsOptional()
  @IsInt()
  @Min(0)
  onlineOrdersMinLeadMinutes?: number;

  @IsOptional()
  @IsBoolean()
  onlineOrdersAutoAcceptEnabled?: boolean;

  @IsOptional()
  @IsEnum(OnlineOrdersSlotMode)
  onlineOrdersAutoAcceptSlotMode?: OnlineOrdersSlotMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  onlineOrdersAutoAcceptPerSlot?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  onlineOrdersAutoAcceptPerSlotPickup?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  onlineOrdersAutoAcceptPerSlotDelivery?: number;

  /** null = nessun limite di raggio per la consegna. */
  @IsOptional()
  @IsInt()
  @Min(1)
  deliveryRadiusMeters?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFee?: number;

  /** null = mai gratuita sopra soglia. */
  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryFreeAboveAmount?: number | null;

  @IsOptional()
  @IsBoolean()
  loyverseSyncOnlineOrders?: boolean;

  @IsOptional()
  @IsString()
  loyversePaymentTypeIdCash?: string | null;

  @IsOptional()
  @IsString()
  loyversePaymentTypeIdCardOnline?: string | null;

  @IsOptional()
  @IsString()
  loyversePaymentTypeIdCardInStore?: string | null;
}
