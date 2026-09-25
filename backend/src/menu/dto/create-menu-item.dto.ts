import { Allergen, MenuAvailability } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
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

  /** Canale "ordini online" (§5.10 di DEVELOPMENT.md): flag di presentazione, come visible/featured. */
  @IsOptional()
  @IsBoolean()
  orderableOnline?: boolean;

  /** Gruppi di modificatori applicabili a questa voce, sostituiti sempre tutti insieme come le varianti. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  modifierGroupIds?: string[];
}
