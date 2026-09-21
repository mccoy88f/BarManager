import { ArrayMaxSize, IsArray, IsEmail, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateSupplierDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsArray()
  ccEmails?: string[];

  @IsOptional()
  @IsString()
  phone?: string;

  /** Giorni della settimana in cui va fatto l'ordine: 1=lunedì .. 7=domenica. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  orderDays?: number[];
}
