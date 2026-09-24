import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MeService } from './me.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/** "Il mio profilo" (§7 di DEVELOPMENT.md): accessibile a qualunque ruolo autenticato, nessun controllo di ruolo oltre al login. */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private meService: MeService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.meService.getOwnProfile(user.userId);
  }

  @Patch()
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.meService.updateOwnProfile(user.userId, dto);
  }

  @Patch('password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.meService.changeOwnPassword(user.userId, dto);
  }
}
