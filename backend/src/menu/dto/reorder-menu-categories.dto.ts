import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderMenuCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  categoryIds: string[];
}
