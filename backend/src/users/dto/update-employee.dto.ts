import { IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const MODULE_KEYS = ['haccp', 'inventory', 'menu', 'tasks'];

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

  /** Moduli extra concessi (vedi ModuleAccessGuard): vuoto = default del ruolo. */
  @IsOptional()
  @IsArray()
  @IsIn(MODULE_KEYS, { each: true })
  allowedModules?: string[];

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
