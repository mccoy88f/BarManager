import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

  @IsOptional()
  @IsNumber()
  costPerUnit?: number;

  /** Es. un cartone di birre contiene 24 lattine: puramente informativo. */
  @IsOptional()
  @IsInt()
  @Min(1)
  unitsPerPackage?: number;

  @IsString()
  categoryId: string;

  @IsString()
  supplierId: string;
}
