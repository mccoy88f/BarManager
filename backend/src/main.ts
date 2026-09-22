import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';

/**
 * auth.service.ts/jwt.strategy.ts ricadono su un segreto di sviluppo
 * fisso quando JWT_ACCESS_SECRET/JWT_REFRESH_SECRET non sono impostati:
 * comodo in locale, ma se dimenticato in produzione chiunque potrebbe
 * forgiare token validi. Meglio bloccare l'avvio che scoprirlo dopo.
 */
function assertJwtSecretsConfigured() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error(
      'JWT_ACCESS_SECRET e JWT_REFRESH_SECRET devono essere impostati in produzione (NODE_ENV=production).',
    );
  }
}

async function bootstrap() {
  assertJwtSecretsConfigured();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const uploadsDir = process.env.UPLOADS_DIR || './uploads';
  mkdirSync(`${uploadsDir}/menu`, { recursive: true });
  mkdirSync(`${uploadsDir}/board`, { recursive: true });
  mkdirSync(`${uploadsDir}/kb`, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  // Host esplicito: senza, Node sceglie l'indirizzo di bind da solo e in
  // certi ambienti container (IPv6/dual-stack non disponibile o
  // configurato in modo particolare) può non essere raggiungibile su
  // "localhost" come lo risolve l'healthcheck Docker, pur con l'app
  // regolarmente avviata — sintomo: log puliti ma container "unhealthy".
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`BarManager API listening on 0.0.0.0:${port}`);
}

bootstrap();
