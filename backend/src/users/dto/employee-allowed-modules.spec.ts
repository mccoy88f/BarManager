import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEmployeeDto } from './create-employee.dto';
import { UpdateEmployeeDto } from './update-employee.dto';
import { MODULE_KEYS } from '../../common/decorators/require-module.decorator';

/**
 * Bug riportato dall'utente: creando un dipendente e selezionando "tutti i
 * moduli" la richiesta falliva con "each value in allowedModules must be
 * one of the following values: haccp, inventory, menu, tasks" — l'elenco
 * di validazione nei DTO era rimasto fermo a 4 chiavi quando ModuleKey
 * (common/decorators/require-module.decorator.ts, la fonte autoritativa
 * usata da ModuleAccessGuard) ne ha 8. Questo test verifica che i DTO
 * accettino sempre l'intero elenco di ModuleKey, non una copia propria.
 */
describe('allowedModules nei DTO employee accetta ogni ModuleKey', () => {
  it('CreateEmployeeDto non genera errori di validazione con tutte le chiavi di ModuleKey', async () => {
    const dto = plainToInstance(CreateEmployeeDto, {
      firstName: 'Mario',
      lastName: 'Rossi',
      email: 'mario@test.it',
      password: 'password123',
      allowedModules: [...MODULE_KEYS],
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('UpdateEmployeeDto non genera errori di validazione con tutte le chiavi di ModuleKey', async () => {
    const dto = plainToInstance(UpdateEmployeeDto, { allowedModules: [...MODULE_KEYS] });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
