import { PartialType } from '@nestjs/mapped-types';
import { CreateFridgeDto } from './create-fridge.dto';

export class UpdateFridgeDto extends PartialType(CreateFridgeDto) {}
