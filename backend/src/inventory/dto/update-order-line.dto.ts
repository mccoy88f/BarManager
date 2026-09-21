import { IsNumber } from 'class-validator';

export class UpdateOrderLineDto {
  @IsNumber()
  orderedQty: number;
}
