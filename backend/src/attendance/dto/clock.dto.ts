import { IsString } from 'class-validator';

export class ClockDto {
  @IsString()
  qrToken: string;
}
