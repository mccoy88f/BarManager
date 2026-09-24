import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Globale come PrismaModule/AuditModule: un solo transporter SMTP per tutta l'app, iniettabile ovunque senza doverlo importare modulo per modulo. */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
