import { IsArray, IsOptional, IsString } from 'class-validator';

export class RenderPrintPdfDto {
  @IsString()
  title: string;

  @IsArray()
  @IsString({ each: true })
  lines: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  footer?: string[];
}
