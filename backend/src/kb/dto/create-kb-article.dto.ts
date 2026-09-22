import { IsString, MinLength } from 'class-validator';

export class CreateKbArticleDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  contentHtml: string;
}
