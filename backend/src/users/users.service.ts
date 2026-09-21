import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

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

  async setActive(employeeId: string, active: boolean) {
    const employee = await this.prisma.employee.update({
      where: { id: employeeId },
      data: { active },
    });
    if (employee.userId) {
      await this.prisma.user.update({ where: { id: employee.userId }, data: { active } });
    }
    return employee;
  }
}
