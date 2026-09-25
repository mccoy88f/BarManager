import { PartialType } from '@nestjs/mapped-types';
import { CreateMenuModifierGroupDto } from './create-menu-modifier-group.dto';

export class UpdateMenuModifierGroupDto extends PartialType(CreateMenuModifierGroupDto) {}
