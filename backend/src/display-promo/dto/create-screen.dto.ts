import { IsString, MinLength } from 'class-validator';

export class CreateScreenDto {
  @IsString()
  @MinLength(1)
  name: string;
}
