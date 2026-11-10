import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** Esito della stampa fiscale RCH eseguita dall'APK Android. */
export class AckFiscalReceiptDto {
  @IsBoolean()
  success: boolean;

  @IsOptional()
  @IsString()
  error?: string;
}
