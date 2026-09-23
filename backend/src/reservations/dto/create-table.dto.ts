import { IsInt, IsString, MinLength, Min } from 'class-validator';

export class CreateTableDto {
  @IsString()
  @MinLength(1)
  label: string;

  @IsInt()
  @Min(1)
  seats: number;
}
