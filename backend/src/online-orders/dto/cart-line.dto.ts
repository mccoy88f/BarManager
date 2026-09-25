import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** Una riga del carrello lato cliente: solo id + quantità, il prezzo è sempre ricalcolato lato server. */
export class CartLineDto {
  @IsString()
  menuItemId: string;

  @IsString()
  variantId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  modifierOptionIds?: string[];

  @IsOptional()
  @IsString()
  note?: string;
}

export class CartDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];
}
