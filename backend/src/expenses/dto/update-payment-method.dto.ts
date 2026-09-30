import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
