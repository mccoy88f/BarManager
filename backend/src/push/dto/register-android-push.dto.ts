import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterAndroidPushDto {
  /** Token già rilasciato a questo apparecchio, se l'app lo ricorda. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  token?: string;
}
