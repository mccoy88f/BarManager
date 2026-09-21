import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  role?: string; // mansione

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isManager?: boolean;

  /** Email di accesso (User): aggiorna solo se il dipendente ha un account. */
  @IsOptional()
  @IsEmail()
  email?: string;

  /** Nuova password di accesso: opzionale, aggiorna solo se valorizzata. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
