import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { MeService } from './me.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-new-password'),
}));

describe('MeService', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    employee: { update: jest.Mock };
  };
  let service: MeService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      employee: { update: jest.fn() },
    };
    service = new MeService(prisma as unknown as PrismaService);
  });

  describe('getOwnProfile', () => {
    it('restituisce email/ruolo e i dati Employee se collegato', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'mario@test.it',
        role: 'MANAGER',
        employee: { firstName: 'Mario', lastName: 'Rossi', phone: '333' },
      });

      const result = await service.getOwnProfile('u1');

      expect(result).toEqual({
        id: 'u1',
        email: 'mario@test.it',
        role: 'MANAGER',
        firstName: 'Mario',
        lastName: 'Rossi',
        phone: '333',
      });
    });

    it('restituisce firstName/lastName/phone null se non c\'è un Employee collegato (es. Admin)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'admin@test.it',
        role: 'ADMIN',
        employee: null,
      });

      const result = await service.getOwnProfile('u1');

      expect(result).toEqual({
        id: 'u1',
        email: 'admin@test.it',
        role: 'ADMIN',
        firstName: null,
        lastName: null,
        phone: null,
      });
    });

    it('rifiuta con NotFoundException se l\'utente non esiste', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getOwnProfile('bad-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateOwnProfile', () => {
    it('aggiorna solo email se non c\'è un Employee collegato', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1', email: 'admin@test.it', employee: null })
        .mockResolvedValueOnce(null) // controllo email già in uso: nessuno
        .mockResolvedValueOnce({ id: 'u1', email: 'nuova@test.it', role: 'ADMIN', employee: null });

      await service.updateOwnProfile('u1', { email: 'nuova@test.it' });

      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { email: 'nuova@test.it' } });
      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('rifiuta con ConflictException se l\'email è già usata da un altro account', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1', email: 'admin@test.it', employee: null })
        .mockResolvedValueOnce({ id: 'altro-utente', email: 'occupata@test.it' });

      await expect(service.updateOwnProfile('u1', { email: 'occupata@test.it' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('aggiorna i dati Employee (nome/cognome/telefono) se collegato', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({ id: 'u1', email: 'mario@test.it', employee: { id: 'emp1' } })
        .mockResolvedValueOnce({
          id: 'u1',
          email: 'mario@test.it',
          role: 'MANAGER',
          employee: { firstName: 'Mario', lastName: 'Verdi', phone: '333' },
        });

      await service.updateOwnProfile('u1', { lastName: 'Verdi' });

      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp1' },
        data: { lastName: 'Verdi' },
      });
    });

    it('rifiuta con NotFoundException se l\'utente non esiste', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.updateOwnProfile('bad-id', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('changeOwnPassword', () => {
    it('cambia la password se quella attuale è corretta', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'old-hash', employee: null });
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.changeOwnPassword('u1', {
        currentPassword: 'vecchia123',
        newPassword: 'nuovaPassword123',
      });

      expect(result).toEqual({ success: true });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'hashed-new-password' },
      });
    });

    it('rifiuta con UnauthorizedException se la password attuale è sbagliata', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'old-hash', employee: null });
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changeOwnPassword('u1', { currentPassword: 'sbagliata', newPassword: 'nuovaPassword123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rifiuta con BadRequestException se la nuova password è identica alla attuale', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'old-hash', employee: null });
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await expect(
        service.changeOwnPassword('u1', { currentPassword: 'stessaPassword', newPassword: 'stessaPassword' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
