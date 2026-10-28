import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderMediaDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  mediaIds: string[];
}
