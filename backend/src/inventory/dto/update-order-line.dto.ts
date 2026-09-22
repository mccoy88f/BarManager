import { IsNumber, Min } from 'class-validator';

export class UpdateOrderLineDto {
  @IsNumber()
  @Min(0)
  orderedQty: number;
}
