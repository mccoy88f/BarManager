import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

/** Accetta senza login, dal link nell'email al locale. */
export class ManageAcceptDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tableIds?: string[];
}
