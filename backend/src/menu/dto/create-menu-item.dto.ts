import { Allergen, MenuAvailability } from '@prisma/client';
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateMenuItemDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  price: number;

  @IsString()
  categoryId: string;

  @IsOptional()
  @IsArray()
  @IsEnum(Allergen, { each: true })
  allergens?: Allergen[];

  @IsOptional()
  @IsEnum(MenuAvailability)
  availability?: MenuAvailability;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
