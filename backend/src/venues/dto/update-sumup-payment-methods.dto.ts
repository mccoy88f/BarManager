import { IsArray, IsString } from 'class-validator';

/** Metodi di pagamento SumUp scelti dall'admin, tra quelli davvero disponibili per l'account (v. VenuesController.verifySumUpPaymentMethods). */
export class UpdateSumUpPaymentMethodsDto {
  @IsArray()
  @IsString({ each: true })
  methods: string[];
}
