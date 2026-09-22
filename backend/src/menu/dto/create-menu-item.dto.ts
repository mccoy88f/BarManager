import { Allergen, MenuAvailability } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { MenuItemVariantDto } from './menu-item-variant.dto';

export class CreateMenuItemDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Quasi sempre una sola riga; più righe per formati/taglie diverse. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MenuItemVariantDto)
  variants: MenuItemVariantDto[];

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
