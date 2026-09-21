import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // Super Admin di piattaforma: nessun venueId, crea/gestisce i locali.
  const superAdminPasswordHash = await argon2.hash('superadmin123');
  await prisma.user.upsert({
    where: { email: 'superadmin@barmanager.local' },
    update: {},
    create: {
      email: 'superadmin@barmanager.local',
      passwordHash: superAdminPasswordHash,
      role: Role.SUPER_ADMIN,
    },
  });

  // Locale demo con il suo Admin, utile per sviluppare senza passare
  // ogni volta dal pannello Super Admin.
  const venue = await prisma.venue.upsert({
    where: { id: 'seed-venue' },
    update: {},
    create: { id: 'seed-venue', name: 'Il Mio Bar', slug: 'demo' },
  });

  const adminPasswordHash = await argon2.hash('admin123');
  await prisma.user.upsert({
    where: { email: 'admin@barmanager.local' },
    update: {},
    create: {
      email: 'admin@barmanager.local',
      passwordHash: adminPasswordHash,
      role: Role.ADMIN,
      venueId: venue.id,
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    'Seed completato.\n' +
      '- Super Admin: superadmin@barmanager.local / superadmin123\n' +
      '- Admin locale demo (slug "demo"): admin@barmanager.local / admin123',
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
