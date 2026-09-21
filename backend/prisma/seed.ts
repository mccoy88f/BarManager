import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const venue = await prisma.venue.upsert({
    where: { id: 'seed-venue' },
    update: {},
    create: { id: 'seed-venue', name: 'Il Mio Bar' },
  });

  const passwordHash = await argon2.hash('admin123');
  await prisma.user.upsert({
    where: { email: 'admin@barmanager.local' },
    update: {},
    create: {
      email: 'admin@barmanager.local',
      passwordHash,
      role: Role.ADMIN,
      venueId: venue.id,
    },
  });

  // eslint-disable-next-line no-console
  console.log('Seed completato. Login admin: admin@barmanager.local / admin123');
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
