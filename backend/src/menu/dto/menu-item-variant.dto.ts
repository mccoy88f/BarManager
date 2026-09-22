import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class MenuItemVariantDto {
  /** Vuoto quando il prodotto ha un solo prezzo (caso più comune). */
  @IsOptional()
  @IsString()
  name?: string;

  @IsNumber()
  @Min(0)
  price: number;
}
