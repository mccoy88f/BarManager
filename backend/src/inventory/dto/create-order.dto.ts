import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsString, ValidateNested } from 'class-validator';

class OrderLineInput {
  @IsString()
  productId: string;

  @IsNumber()
  stockOnHand: number;
}

export class CreateOrderDto {
  @IsString()
  supplierId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineInput)
  lines: OrderLineInput[];
}
