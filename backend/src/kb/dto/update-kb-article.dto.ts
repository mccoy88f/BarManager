import { PartialType } from '@nestjs/mapped-types';
import { CreateKbArticleDto } from './create-kb-article.dto';

export class UpdateKbArticleDto extends PartialType(CreateKbArticleDto) {}
