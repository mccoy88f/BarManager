import { NotFoundException } from '@nestjs/common';
import { KbService } from './kb.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = {
  userId: 'admin-1',
  email: 'admin@venue1.test',
  role: 'ADMIN',
  venueId: 'venue-1',
};

describe('KbService', () => {
  let prisma: {
    kbArticle: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let service: KbService;

  beforeEach(() => {
    prisma = {
      kbArticle: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new KbService(prisma as unknown as PrismaService);
  });

  it('sanifica lo script prima di salvare un nuovo articolo', async () => {
    prisma.kbArticle.create.mockResolvedValue({ id: 'art-1' });
    await service.create(admin, {
      title: 'Come pulire la macchina del caffè',
      contentHtml: '<p>Passo 1</p><script>alert(1)</script><img src="/uploads/kb/x.png">',
    });
    const data = prisma.kbArticle.create.mock.calls[0][0].data;
    expect(data.contentHtml).not.toContain('<script>');
    expect(data.contentHtml).toContain('<p>Passo 1</p>');
    expect(data.contentHtml).toContain('<img src="/uploads/kb/x.png"');
  });

  it('rimuove attributi non consentiti come onerror', async () => {
    prisma.kbArticle.create.mockResolvedValue({ id: 'art-1' });
    await service.create(admin, {
      title: 'Test',
      contentHtml: '<img src="/uploads/kb/x.png" onerror="alert(1)">',
    });
    const data = prisma.kbArticle.create.mock.calls[0][0].data;
    expect(data.contentHtml).not.toContain('onerror');
  });

  it('rifiuta la modifica di un articolo di un altro locale', async () => {
    prisma.kbArticle.findUnique.mockResolvedValue({ id: 'art-1', venueId: 'venue-2' });
    await expect(
      service.update('venue-1', 'art-1', { title: 'Nuovo titolo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.kbArticle.update).not.toHaveBeenCalled();
  });

  it('mantiene intatta la card di un allegato incorporato (link, download, stile)', async () => {
    prisma.kbArticle.create.mockResolvedValue({ id: 'art-1' });
    const attachmentHtml =
      '<div class="kb-attachment" style="display:inline-flex;gap:10px;">' +
      '<a href="/uploads/kb/x.pdf" target="_blank" rel="noopener noreferrer">manuale.pdf</a>' +
      '<a href="/uploads/kb/x.pdf" download="manuale.pdf" style="font-size:0.85em;">Scarica</a>' +
      '</div>';
    await service.create(admin, { title: 'Manuale', contentHtml: attachmentHtml });
    const data = prisma.kbArticle.create.mock.calls[0][0].data;
    expect(data.contentHtml).toContain('class="kb-attachment"');
    expect(data.contentHtml).toContain('href="/uploads/kb/x.pdf"');
    expect(data.contentHtml).toContain('download="manuale.pdf"');
    expect(data.contentHtml).toContain('style="font-size:0.85em"');
  });

  it('list restituisce solo i campi di anteprima, non il contenuto completo', async () => {
    prisma.kbArticle.findMany.mockResolvedValue([]);
    await service.list('venue-1');
    expect(prisma.kbArticle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      }),
    );
  });
});
