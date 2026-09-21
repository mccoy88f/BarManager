import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

/**
 * Gli account (User) vengono creati esclusivamente dall'amministratore,
 * come richiesto: un dipendente non può auto-registrarsi.
 */
@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async createEmployee(venueId: string, dto: CreateEmployeeDto) {
    const passwordHash = await AuthService.hashPassword(dto.password);

    return this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        role: Role.EMPLOYEE,
        venueId,
        employee: {
          create: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: dto.role,
            department: dto.department,
            isManager: dto.isManager ?? false,
            venueId,
          },
        },
      },
      include: { employee: true },
    });
  }

  findAllForVenue(venueId: string) {
    return this.prisma.employee.findMany({
      where: { venueId },
      include: { user: { select: { id: true, email: true, active: true, role: true } } },
      orderBy: { lastName: 'asc' },
    });
  }

  async setActive(venueId: string, employeeId: string, active: boolean) {
    await this.assertOwnership(venueId, employeeId);
    const employee = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { active },
    });
    if (employee.userId) {
      await this.prisma.user.update({ where: { id: employee.userId }, data: { active } });
    }
    return employee;
  }

  async updateEmployee(venueId: string, employeeId: string, dto: UpdateEmployeeDto) {
    const employee = await this.assertOwnership(venueId, employeeId);
    const { email, password, ...employeeFields } = dto;

    if (employee.userId && (email || password)) {
      await this.prisma.user.update({
        where: { id: employee.userId },
        data: {
          ...(email ? { email } : {}),
          ...(password ? { passwordHash: await AuthService.hashPassword(password) } : {}),
        },
      });
    }

    return this.prisma.employee.update({
      where: { id: employeeId },
      data: employeeFields,
      include: { user: { select: { id: true, email: true, active: true, role: true } } },
    });
  }

  async removeEmployee(venueId: string, employeeId: string) {
    const employee = await this.assertOwnership(venueId, employeeId);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.employee.delete({ where: { id: employeeId } });
        if (employee.userId) {
          await tx.user.delete({ where: { id: employee.userId } });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new ConflictException(
          'Non è possibile eliminare questo dipendente: ha timbrature, richieste ferie o attività collegate. Disattivalo invece di eliminarlo.',
        );
      }
      throw e;
    }
    return { success: true };
  }

  private async assertOwnership(venueId: string, employeeId: string) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.venueId !== venueId) {
      throw new NotFoundException('Dipendente non trovato');
    }
    return employee;
  }
}
