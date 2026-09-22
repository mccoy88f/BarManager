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
import { KbService } from './kb.service';
import { CreateKbArticleDto } from './dto/create-kb-article.dto';
import { UpdateKbArticleDto } from './dto/update-kb-article.dto';

// Nessun ModuleAccessGuard/RequireModule: la KBpedia è sempre visibile a
// tutti gli utenti del locale, non è un modulo concedibile per dipendente.
@Controller('kb')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KbController {
  constructor(private kbService: KbService) {}

  @Post('articles')
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateKbArticleDto) {
    return this.kbService.create(user, dto);
  }

  @Get('articles')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.kbService.list(requireVenueId(user));
  }

  @Get('articles/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.kbService.get(requireVenueId(user), id);
  }

  @Patch('articles/:id')
  @Roles(Role.ADMIN)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateKbArticleDto,
  ) {
    return this.kbService.update(requireVenueId(user), id, dto);
  }

  @Delete('articles/:id')
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.kbService.remove(requireVenueId(user), id);
  }

  /** Carica un'immagine o un breve video da incorporare nel testo dell'articolo. */
  @Post('media')
  @Roles(Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: `${process.env.UPLOADS_DIR || './uploads'}/kb`,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB, per brevi clip video
      fileFilter: (_req, file, cb) => {
        cb(null, /^(image\/(jpe?g|png|webp|gif)|video\/(mp4|webm|ogg))$/.test(file.mimetype));
      },
    }),
  )
  uploadMedia(@UploadedFile() file: Express.Multer.File) {
    return {
      url: `/uploads/kb/${file.filename}`,
      kind: file.mimetype.startsWith('video/') ? 'video' : 'image',
    };
  }
}
