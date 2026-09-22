import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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

  /** Una stampante può servire più usi insieme (es. HACCP e ordini). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PrinterUsage, { each: true })
  usages?: PrinterUsage[];
}
