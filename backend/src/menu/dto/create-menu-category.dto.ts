import { MenuAvailability } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateMenuCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsEnum(MenuAvailability)
  availability?: MenuAvailability;
}
