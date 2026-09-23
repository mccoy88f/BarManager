import { IsOptional, IsString } from 'class-validator';

/** tableId assente/null = rimuove l'assegnazione. */
export class AssignTableDto {
  @IsOptional()
  @IsString()
  tableId?: string | null;
}
