import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * `marketingConsent` non è un campo di questo DTO: il consenso marketing è
 * dato/ritirato solo dal cliente stesso (alla prenotazione, o dalla pagina
 * pubblica "gestisci i tuoi dati personali"), mai dallo staff da qui — v.
 * CustomersService.create, che lo forza sempre a `false` per un cliente
 * inserito a mano.
 */
export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
