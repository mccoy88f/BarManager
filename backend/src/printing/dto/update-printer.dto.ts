import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreatePrinterDto } from './create-printer.dto';

export class UpdatePrinterDto extends PartialType(CreatePrinterDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
