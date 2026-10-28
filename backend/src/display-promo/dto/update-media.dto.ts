import { IsInt, IsOptional, Min } from 'class-validator';

/** Solo le foto usano questo campo: i video durano quanto il file (§5.12). */
export class UpdateMediaDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number;
}
