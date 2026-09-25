import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** Credenziali SumUp del locale (§5.10): stesso schema del token Loyverse, sempre cifrate. */
export class UpdateSumUpSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  apiKey?: string | null;
}
