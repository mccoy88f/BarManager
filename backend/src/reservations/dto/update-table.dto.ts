import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class UpdateTableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  seats?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
