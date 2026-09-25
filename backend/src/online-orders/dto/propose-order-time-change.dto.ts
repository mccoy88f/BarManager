import { IsISO8601 } from 'class-validator';

export class ProposeOrderTimeChangeDto {
  @IsISO8601()
  requestedAt: string;
}
