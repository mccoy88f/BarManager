import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator';
import { OrderLineInput } from './create-order.dto';

/**
 * Come CreateOrderDto ma per categoria: le righe possono appartenere a
 * prodotti di fornitori diversi, e il servizio le divide in un ordine
 * per fornitore.
 */
export class CreateOrdersByCategoryDto {
  @IsString()
  categoryId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInput)
  lines: OrderLineInput[];
}
