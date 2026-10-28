import { IsBoolean, IsOptional } from 'class-validator';

/** La playlist di default è per singolo schermo (DisplayPromoScreen), non qui: v. PATCH /display-promo/screens/:id. */
export class UpdateDisplayPromoSettingsDto {
  @IsOptional()
  @IsBoolean()
  displayPromoEnabled?: boolean;
}
