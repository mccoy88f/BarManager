import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterKioskDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  deviceId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(128)
  deviceInfo?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  appVersion?: string;

  @IsString()
  @IsOptional()
  @MaxLength(32)
  code?: string;
}
