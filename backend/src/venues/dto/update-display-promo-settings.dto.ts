import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUrl } from 'class-validator';

const emptyToNull = ({ value }: { value: string }) => (value === '' ? null : value);

/** La playlist di default è per singolo schermo (DisplayPromoScreen), non qui: v. PATCH /display-promo/screens/:id. */
export class UpdateDisplayPromoSettingsDto {
  @IsOptional()
  @IsBoolean()
  displayPromoEnabled?: boolean;

  /** Feed RSS (es. ANSA) per il ticker "ultim'ora", condiviso da tutti gli schermi del locale. */
  @IsOptional()
  @Transform(emptyToNull)
  @IsUrl()
  displayPromoNewsFeedUrl?: string | null;
}
