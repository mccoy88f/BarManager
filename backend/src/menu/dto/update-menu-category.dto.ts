import { IsString } from 'class-validator';

export class UpdateMenuCategoryDto {
  @IsString()
  name: string;
}
