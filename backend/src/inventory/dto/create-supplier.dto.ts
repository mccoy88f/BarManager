import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';

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
}
