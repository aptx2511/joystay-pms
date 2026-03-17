import { PrismaClient } from "@prisma/client";
import { addDays, startOfToday } from "date-fns";

const prisma = new PrismaClient();

const ROOMS = [
  { name: "Pop Art Studio",    size: 25, sortOrder: 1 },
  { name: "B&W Studio Large",  size: 25, sortOrder: 2 },
  { name: "Indochine Room",    size: 15, sortOrder: 3 },
  { name: "Midcentury Room",   size: 15, sortOrder: 4 },
  { name: "B&W Room Small",    size: 15, sortOrder: 5 },
];

async function main() {
  console.log("🌱  Seeding Joystay database…");

  // Upsert rooms (safe to re-run)
  for (const room of ROOMS) {
    await prisma.room.upsert({
      where:  { name: room.name },
      update: { size: room.size, sortOrder: room.sortOrder },
      create: room,
    });
  }

  console.log("✅  5 rooms created.");

  // Add a handful of sample bookings so the calendar looks alive
  const rooms = await prisma.room.findMany({ orderBy: { sortOrder: "asc" } });
  const today = startOfToday();

  const sampleBookings = [
    {
      roomId:    rooms[0].id,
      guestName: "Nguyen Van A",
      checkIn:   addDays(today, 1),
      checkOut:  addDays(today, 4),
      source:    "AIRBNB",
      status:    "CONFIRMED",
      totalPrice: 1800000,
      externalId: "SAMPLE-AIRBNB-001",
    },
    {
      roomId:    rooms[1].id,
      guestName: "Tran Thi B",
      checkIn:   addDays(today, 2),
      checkOut:  addDays(today, 5),
      source:    "DIRECT",
      status:    "CONFIRMED",
      totalPrice: 2100000,
      externalId: null,
    },
    {
      roomId:    rooms[2].id,
      guestName: "Le Van C",
      checkIn:   addDays(today, -1),
      checkOut:  addDays(today, 2),
      source:    "OFFLINE",
      status:    "CONFIRMED",
      totalPrice: 900000,
      externalId: null,
    },
    {
      roomId:    rooms[3].id,
      guestName: "Pham Thi D",
      checkIn:   addDays(today, 5),
      checkOut:  addDays(today, 8),
      source:    "AIRBNB",
      status:    "CONFIRMED",
      totalPrice: 1350000,
      externalId: "SAMPLE-AIRBNB-002",
    },
    {
      roomId:    rooms[4].id,
      guestName: "Hoang Van E",
      checkIn:   addDays(today, 3),
      checkOut:  addDays(today, 6),
      source:    "DIRECT",
      status:    "PENDING",
      totalPrice: 1050000,
      externalId: null,
    },
  ];

  for (const booking of sampleBookings) {
    // Skip if this sample already exists (re-run safety)
    if (booking.externalId) {
      const exists = await prisma.booking.findFirst({
        where: { roomId: booking.roomId, externalId: booking.externalId },
      });
      if (exists) continue;
    }
    await prisma.booking.create({ data: booking });
  }

  console.log("✅  Sample bookings created.");
  console.log("🏨  Joystay PMS is ready!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
