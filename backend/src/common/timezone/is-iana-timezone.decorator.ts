import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Un fuso orario non valido non fallirebbe rumorosamente: verrebbe passato
 * a Luxon (v. timezone.ts) che produrrebbe silenziosamente una DateTime
 * "invalid" e quindi date sbagliate ovunque nell'app — va quindi rifiutato
 * subito in ingresso, non lasciato passare come una stringa qualsiasi.
 * `Intl.supportedValuesOf('timeZone')` (Node 18+) è la lista IANA
 * effettivamente riconosciuta dal runtime, non una lista statica da
 * mantenere a mano.
 */
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

export function IsIanaTimezone(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && VALID_TIMEZONES.has(value);
        },
        defaultMessage(): string {
          return 'Fuso orario non valido';
        },
      },
    });
  };
}
