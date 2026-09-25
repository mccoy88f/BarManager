import { IsEnum, IsOptional } from 'class-validator';
import { OnlineOrderPaymentMethod } from '@prisma/client';

/**
 * Completamento di un ordine da ritiro (§5.10): l'operatore registra a
 * mano come il cliente ha effettivamente pagato in negozio — CASH o
 * CARD_IN_STORE, mai CARD_ONLINE qui. Per la consegna il pagamento è già
 * noto dal checkout, quindi paymentMethod non serve (ignorato se inviato).
 */
export class CompleteOnlineOrderDto {
  @IsOptional()
  @IsEnum(OnlineOrderPaymentMethod)
  paymentMethod?: OnlineOrderPaymentMethod;
}
