import { IsString, MinLength } from 'class-validator';

export class RejectOnlineOrderDto {
  @IsString()
  @MinLength(1)
  reason: string;
}
