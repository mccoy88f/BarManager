import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsString()
  unit: string;

  @IsNumber()
  standardQty: number;

  @IsOptional()
  @IsNumber()
  reorderAt?: number;

  @IsOptional()
  @IsString()
  supplierCode?: string;

  @IsString()
  categoryId: string;

  @IsString()
  supplierId: string;
}
