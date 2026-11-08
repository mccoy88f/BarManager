import { IsString, MaxLength } from 'class-validator';

export class RegisterWebPushDto {
  @IsString()
  @MaxLength(2000)
  endpoint: string;

  @IsString()
  @MaxLength(300)
  p256dh: string;

  @IsString()
  @MaxLength(300)
  auth: string;
}
