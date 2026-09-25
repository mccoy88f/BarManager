import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class MenuModifierOptionDto {
  @IsString()
  name: string;

  /** Può essere 0, es. "Senza cipolla". */
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}
