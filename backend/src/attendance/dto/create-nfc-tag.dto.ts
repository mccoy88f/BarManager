import { IsString, MinLength } from 'class-validator';

export class CreateNfcTagDto {
  @IsString()
  label: string;

  /** Testo che l'admin scrive poi sul tag fisico con un'app di terze parti. */
  @IsString()
  @MinLength(4)
  value: string;
}
