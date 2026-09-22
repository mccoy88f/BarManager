import { PartialType } from '@nestjs/mapped-types';
import { CreateCleaningTaskDto } from './create-cleaning-task.dto';

export class UpdateCleaningTaskDto extends PartialType(CreateCleaningTaskDto) {}
