import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OnlineOrderFulfillment, OnlineOrderPaymentMethod } from '@prisma/client';
import { CartLineDto } from './cart-line.dto';

/** Corpo del checkout pubblico /ordina (nessun login). */
export class CreateOnlineOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  lines: CartLineDto[];

  @IsEnum(OnlineOrderFulfillment)
  fulfillment: OnlineOrderFulfillment;

  /** Orario desiderato di ritiro/consegna, ISO 8601 — v. validateRequestedTime nel service. */
  @IsISO8601()
  requestedAt: string;

  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  phone: string;

  /** Solo per fulfillment = DELIVERY. */
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsNumber()
  deliveryLat?: number;

  @IsOptional()
  @IsNumber()
  deliveryLng?: number;

  /** Solo per fulfillment = DELIVERY: CASH o CARD_ONLINE (mai CARD_IN_STORE, deciso solo dall'operatore al ritiro). */
  @IsOptional()
  @IsEnum(OnlineOrderPaymentMethod)
  paymentMethod?: OnlineOrderPaymentMethod;

  /** Checkout SumUp già creato e pagato (v. POST /public/online-orders/sumup-checkout), solo se paymentMethod = CARD_ONLINE. */
  @IsOptional()
  @IsString()
  sumupCheckoutId?: string;

  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;

  @IsOptional()
  @IsBoolean()
  privacyPolicyConsent?: boolean;
}
