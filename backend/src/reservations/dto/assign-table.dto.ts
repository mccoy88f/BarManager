import { IsArray, IsOptional, IsString } from 'class-validator';

/** tableIds assente/vuoto = rimuove ogni assegnazione. Più id = tavoli accostati per un gruppo grande. */
export class AssignTableDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tableIds?: string[];
}
