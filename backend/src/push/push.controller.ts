import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { RegisterAndroidPushDto } from './dto/register-android-push.dto';
import { RegisterWebPushDto } from './dto/register-web-push.dto';
import { PushService } from './push.service';

@Controller('push')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private push: PushService) {}

  @Get('vapid-public-key')
  async vapidPublicKey() {
    return { publicKey: await this.push.vapidPublicKey() };
  }

  @Post('web')
  registerWeb(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterWebPushDto) {
    return this.push.registerWeb(user.userId, dto);
  }

  @Post('android')
  registerAndroid(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterAndroidPushDto) {
    return this.push.registerAndroid(user.userId, dto.token);
  }
}

/** Lettura della coda per l'APK: il token di dispositivo sostituisce il JWT, che scade. */
@Controller('push')
export class PushFeedController {
  constructor(private push: PushService) {}

  @Get('feed')
  feed(
    @Headers('x-device-token') token: string | undefined,
    @Query('since') since?: string,
    @Query('wait') wait?: string,
  ) {
    return this.push.feed(token, since, wait);
  }
}
