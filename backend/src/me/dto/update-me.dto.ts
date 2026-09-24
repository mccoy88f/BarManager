import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Dati modificabili dall'utente stesso (§7 di DEVELOPMENT.md): `email` è
 * quella di login (`User.email`); `firstName`/`lastName`/`phone` esistono
 * solo se l'account ha un `Employee` collegato (Manager/Dipendente — un
 * Admin creato alla provisioning del locale non ne ha uno, v.
 * MeService.getOwnProfile) e vengono semplicemente ignorati altrimenti.
 */
export class UpdateMeDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
