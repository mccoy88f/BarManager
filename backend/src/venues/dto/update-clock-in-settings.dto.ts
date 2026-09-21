import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateClockInSettingsDto {
  @IsOptional()
  @IsBoolean()
  clockInQrEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  clockInGpsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  clockInNfcEnabled?: boolean;

  @IsOptional()
  @Min(-90)
  @Max(90)
  gpsLat?: number;

  @IsOptional()
  @Min(-180)
  @Max(180)
  gpsLng?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1000)
  gpsRadiusMeters?: number;
}
