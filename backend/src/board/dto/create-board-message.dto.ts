import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateBoardMessageDto {
  @IsString()
  @MinLength(1)
  text: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}
