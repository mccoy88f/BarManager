import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrinterUsage } from '@prisma/client';

export class CreatePrinterDto {
  @IsString()
  name: string;

  @IsString()
  host: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsEnum(PrinterUsage)
  usage?: PrinterUsage;
}
