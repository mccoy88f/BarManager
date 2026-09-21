import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateReadingDto {
  @IsString()
  fridgeId: string;

  @IsNumber()
  value: number;

  @IsOptional()
  @IsString()
  correctiveAction?: string; // obbligatoria lato service se il valore risulta fuori soglia
}
