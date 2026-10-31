import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class PairKioskDto {
  @IsString()
  @IsNotEmpty({ message: 'Il codice del dispositivo è obbligatorio' })
  @MaxLength(32)
  code: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  name?: string;
}
