import { IsString, MinLength } from 'class-validator';

/** Rifiuta senza login, dal link nell'email al locale. */
export class ManageRejectDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsString()
  @MinLength(1)
  reason: string;
}
