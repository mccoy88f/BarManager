import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
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

  /** Subtotale minimo (prodotti, senza consegna) per poter ordinare. null = nessun minimo. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  onlineOrdersMinOrderAmount?: number | null;

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
  @IsString()
  loyversePaymentTypeIdCash?: string | null;

  @IsOptional()
  @IsString()
  loyversePaymentTypeIdCardOnline?: string | null;

  @IsOptional()
  @IsString()
  loyversePaymentTypeIdCardInStore?: string | null;

  /** Variante Loyverse da usare come riga "spese di consegna" sulla ricevuta. null = non accoppiata. */
  @IsOptional()
  @IsString()
  loyverseDeliveryVariantId?: string | null;

  @IsOptional()
  @IsBoolean()
  rchFiscalEnabled?: boolean;

  @IsOptional()
  @IsString()
  rchHost?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  rchPort?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  rchDefaultDepartment?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  rchDeliveryDepartment?: number | null;

  /** Indice pulsante Contanti sulla programmazione cassa RCH. null = non configurato. */
  @IsOptional()
  @IsInt()
  @Min(1)
  rchPaymentIndexCash?: number | null;

  /** Indice pulsante Carta/elettronico sulla programmazione cassa RCH. null = non configurato. */
  @IsOptional()
  @IsInt()
  @Min(1)
  rchPaymentIndexCard?: number | null;
}
