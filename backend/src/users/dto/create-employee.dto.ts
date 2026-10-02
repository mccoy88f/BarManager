import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { MODULE_KEYS } from '../../common/decorators/require-module.decorator';

export class CreateEmployeeDto {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  role?: string; // mansione

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsBoolean()
  isManager?: boolean;

  /** Moduli extra concessi (vedi ModuleAccessGuard): vuoto = default del ruolo. */
  @IsOptional()
  @IsArray()
  @IsIn(MODULE_KEYS, { each: true })
  allowedModules?: string[];
}
