import { IsOptional, Matches } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateVenueHoursDto {
  @IsOptional()
  @Matches(HHMM, { message: 'lunchStart deve avere formato HH:mm' })
  lunchStart?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'lunchEnd deve avere formato HH:mm' })
  lunchEnd?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'dinnerStart deve avere formato HH:mm' })
  dinnerStart?: string;

  @IsOptional()
  @Matches(HHMM, { message: 'dinnerEnd deve avere formato HH:mm' })
  dinnerEnd?: string;
}
