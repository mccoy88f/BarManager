import { Injectable, NotFoundException } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, requireVenueId } from '../common/decorators/current-user.decorator';
import { CreateKbArticleDto } from './dto/create-kb-article.dto';
import { UpdateKbArticleDto } from './dto/update-kb-article.dto';

/**
 * Il contenuto arriva dall'editor ricco del frontend come HTML: viene
 * sanificato qui, lato server, prima di essere salvato — così quel che è
 * in database è sempre sicuro da mostrare, anche se un giorno arrivasse
 * incollato da un'altra fonte o l'account admin fosse compromesso.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'b',
    'i',
    'u',
    'strong',
    'em',
    's',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'video',
    'source',
    'h1',
    'h2',
    'h3',
    'blockquote',
    'span',
    'div',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'download', 'style'],
    img: ['src', 'alt', 'style'],
    video: ['src', 'controls', 'style', 'width', 'height'],
    source: ['src', 'type'],
    span: ['style'],
    div: ['style', 'class'],
  },
  allowedSchemes: ['http', 'https', 'data'],
  disallowedTagsMode: 'discard',
};

function sanitize(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

@Injectable()
export class KbService {
  constructor(private prisma: PrismaService) {}

  create(user: AuthenticatedUser, dto: CreateKbArticleDto) {
    return this.prisma.kbArticle.create({
      data: {
        title: dto.title,
        contentHtml: sanitize(dto.contentHtml),
        venueId: requireVenueId(user),
        createdById: user.userId,
      },
    });
  }

  list(venueId: string) {
    return this.prisma.kbArticle.findMany({
      where: { venueId },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(venueId: string, id: string) {
    const article = await this.prisma.kbArticle.findUnique({ where: { id } });
    if (!article || article.venueId !== venueId) {
      throw new NotFoundException('Articolo non trovato');
    }
    return article;
  }

  async update(venueId: string, id: string, dto: UpdateKbArticleDto) {
    await this.get(venueId, id);
    return this.prisma.kbArticle.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.contentHtml !== undefined ? { contentHtml: sanitize(dto.contentHtml) } : {}),
      },
    });
  }

  async remove(venueId: string, id: string) {
    await this.get(venueId, id);
    await this.prisma.kbArticle.delete({ where: { id } });
    return { success: true };
  }
}
