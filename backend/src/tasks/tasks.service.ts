import { Injectable, NotFoundException } from '@nestjs/common';
import { TaskRecurrence, TaskStatus, TaskType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  create(venueId: string, createdById: string, dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        ...dto,
        dueDate: new Date(dto.dueDate),
        venueId,
        createdById,
      },
    });
  }

  list(venueId: string, filters: { status?: TaskStatus; type?: TaskType }) {
    return this.prisma.task.findMany({
      where: { venueId, status: filters.status, type: filters.type },
      include: { relatedEmployee: true, assignedTo: { select: { email: true } } },
      orderBy: { dueDate: 'asc' },
    });
  }

  async update(venueId: string, taskId: string, dto: UpdateTaskDto) {
    await this.assertOwnership(venueId, taskId);
    return this.prisma.task.update({
      where: { id: taskId },
      data: { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined },
    });
  }

  /**
   * Segna l'attività come completata. Se è ricorrente, crea subito la
   * prossima occorrenza (stessa scadenza spostata di un mese/anno), così
   * la scadenza periodica (es. rinnovo attestato) non va reinserita a mano.
   */
  async complete(venueId: string, taskId: string) {
    const task = await this.assertOwnership(venueId, taskId);

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.DONE, completedAt: new Date() },
    });

    if (task.recurrence !== TaskRecurrence.NONE) {
      const nextDueDate = new Date(task.dueDate);
      if (task.recurrence === TaskRecurrence.MONTHLY) {
        nextDueDate.setMonth(nextDueDate.getMonth() + 1);
      } else if (task.recurrence === TaskRecurrence.YEARLY) {
        nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
      }

      await this.prisma.task.create({
        data: {
          title: task.title,
          description: task.description,
          type: task.type,
          dueDate: nextDueDate,
          reminderDaysBefore: task.reminderDaysBefore,
          recurrence: task.recurrence,
          relatedEmployeeId: task.relatedEmployeeId,
          assignedToId: task.assignedToId,
          venueId: task.venueId,
          createdById: task.createdById,
        },
      });
    }

    return updated;
  }

  async remove(venueId: string, taskId: string) {
    await this.assertOwnership(venueId, taskId);
    return this.prisma.task.delete({ where: { id: taskId } });
  }

  private async assertOwnership(venueId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.venueId !== venueId) {
      throw new NotFoundException('Attività non trovata');
    }
    return task;
  }
}
