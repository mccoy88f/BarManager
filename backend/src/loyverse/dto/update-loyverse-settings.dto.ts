import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateLoyverseSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Stringa vuota per rimuovere il token già salvato. */
  @IsOptional()
  @IsString()
  accessToken?: string;
}
