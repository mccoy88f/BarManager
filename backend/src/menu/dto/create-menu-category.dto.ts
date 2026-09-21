import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateMenuCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
