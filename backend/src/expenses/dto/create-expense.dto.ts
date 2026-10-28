import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateExpenseDto {
  @IsString()
  description: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsDateString()
  date: string;

  @IsString()
  paymentMethodId: string;

  @IsString()
  walletId: string;

  /** Fornitore associato, facoltativo (§5.5): omesso/null = spesa/pagamento libero. */
  @IsOptional()
  @IsString()
  supplierId?: string | null;

  /** Scadenza (Attività) che genera questa spesa, se registrata da lì (§5.5). Omesso per una spesa autonoma. */
  @IsOptional()
  @IsString()
  taskId?: string;
}
