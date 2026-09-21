import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateFridgeDto {
  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsNumber()
  minTemp: number;

  @IsNumber()
  maxTemp: number;
}
