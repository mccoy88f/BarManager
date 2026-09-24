import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/** `marketingConsent` non è qui per lo stesso motivo di CreateCustomerDto: non modificabile dallo staff. */
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
