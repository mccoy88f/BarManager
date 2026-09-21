import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
  /** null solo per SUPER_ADMIN, trasversale ai locali. */
  venueId: string | null;
}

/**
 * Estrae il venueId dal contesto per gli endpoint scoperti a un locale
 * (mai raggiungibili dal SUPER_ADMIN grazie ai guard sui ruoli): evita di
 * ripetere il cast/assert `user.venueId!` in ogni controller.
 */
export function requireVenueId(user: AuthenticatedUser): string {
  if (!user.venueId) {
    throw new Error('Operazione riservata agli utenti di un locale');
  }
  return user.venueId;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
