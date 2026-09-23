import { IsString, MinLength } from 'class-validator';

export class RejectReservationDto {
  @IsString()
  @MinLength(1)
  reason: string;
}
