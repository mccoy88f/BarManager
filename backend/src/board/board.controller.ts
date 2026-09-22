import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
  requireVenueId,
} from '../common/decorators/current-user.decorator';
import { BoardService } from './board.service';
import { CreateBoardMessageDto } from './dto/create-board-message.dto';

// Nessun ModuleAccessGuard/RequireModule: la bacheca è sempre visibile a
// tutti gli utenti del locale, non è un modulo concedibile per dipendente.
@Controller('board')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BoardController {
  constructor(private boardService: BoardService) {}

  @Post('messages')
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBoardMessageDto) {
    return this.boardService.create(user, dto);
  }

  @Get('messages')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.boardService.list(requireVenueId(user));
  }

  @Get('messages/pinned')
  listPinned(@CurrentUser() user: AuthenticatedUser) {
    return this.boardService.listPinned(requireVenueId(user));
  }

  @Patch('messages/:id/pin')
  @Roles(Role.ADMIN)
  setPinned(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('pinned') pinned: boolean,
  ) {
    return this.boardService.setPinned(requireVenueId(user), id, pinned);
  }

  @Post('messages/:id/photo')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: diskStorage({
        destination: `${process.env.UPLOADS_DIR || './uploads'}/board`,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
      fileFilter: (_req, file, cb) => {
        cb(null, /^image\/(jpe?g|png|webp)$/.test(file.mimetype));
      },
    }),
  )
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.boardService.setPhoto(requireVenueId(user), id, `/uploads/board/${file.filename}`);
  }

  @Delete('messages/:id')
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.boardService.remove(requireVenueId(user), id);
  }
}
