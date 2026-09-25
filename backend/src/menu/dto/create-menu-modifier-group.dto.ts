import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { MenuModifierSelectionType } from '@prisma/client';
import { MenuModifierOptionDto } from './menu-modifier-option.dto';

/** Gruppo di modificatori (es. "Estras"), applicabile a più voci di menù diverse (§5.10 di DEVELOPMENT.md). */
export class CreateMenuModifierGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(MenuModifierSelectionType)
  selectionType?: MenuModifierSelectionType;

  @IsOptional()
  @IsInt()
  @Min(0)
  minSelections?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxSelections?: number | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MenuModifierOptionDto)
  options: MenuModifierOptionDto[];
}
