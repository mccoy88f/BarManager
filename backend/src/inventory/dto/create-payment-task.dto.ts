import { IsDateString } from 'class-validator';

export class CreatePaymentTaskDto {
  @IsDateString()
  dueDate: string;
}
