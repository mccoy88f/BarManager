import { IsOptional, IsString } from 'class-validator';

/** null/assente = rimuove l'assegnazione per questo slot (si userà la playlist di default). */
export class SetScheduleSlotDto {
  @IsOptional()
  @IsString()
  playlistId?: string | null;
}
