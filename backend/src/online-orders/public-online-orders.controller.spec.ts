import { PublicOnlineOrdersController } from './public-online-orders.controller';
import { MenuAvailability } from '@prisma/client';

describe('PublicOnlineOrdersController.menu', () => {
  let prisma: { menuCategory: { findMany: jest.Mock }; venue: { findFirst: jest.Mock } };
  let menuService: { getAllowedAvailabilities: jest.Mock };
  let controller: PublicOnlineOrdersController;

  beforeEach(() => {
    prisma = {
      menuCategory: { findMany: jest.fn().mockResolvedValue([]) },
      venue: { findFirst: jest.fn() },
    };
    menuService = { getAllowedAvailabilities: jest.fn() };
    controller = new PublicOnlineOrdersController(
      {} as never,
      prisma as never,
      menuService as never,
    );
  });

  /**
   * Stessa fascia pranzo/cena del menù di sola consultazione (§5.10): una
   * voce o categoria "solo pranzo" deve scomparire da /ordina fuori
   * dall'orario di pranzo esattamente come già succede su /menu.
   */
  it('filtra categorie e voci con la fascia corrente del locale', async () => {
    menuService.getAllowedAvailabilities.mockResolvedValue([MenuAvailability.LUNCH, MenuAvailability.ALL_DAY]);

    await controller.menu({ venue: { id: 'venue-1' } } as never);

    expect(menuService.getAllowedAvailabilities).toHaveBeenCalledWith('venue-1');
    const call = prisma.menuCategory.findMany.mock.calls[0][0];
    expect(call.where.availability).toEqual({ in: [MenuAvailability.LUNCH, MenuAvailability.ALL_DAY] });
    expect(call.where.items.some.availability).toEqual({ in: [MenuAvailability.LUNCH, MenuAvailability.ALL_DAY] });
    expect(call.include.items.where.availability).toEqual({ in: [MenuAvailability.LUNCH, MenuAvailability.ALL_DAY] });
  });
});
