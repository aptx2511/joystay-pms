export type BookingSource = "DIRECT" | "AIRBNB" | "OFFLINE";
export type BookingStatus = "CONFIRMED" | "PENDING" | "CANCELLED";

export interface Room {
  id: string;
  name: string;
  size: number;
  icalUrl: string | null;
  createdAt: string;
}

export interface Guest {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

export interface Booking {
  id: string;
  roomId: string;
  guestId: string | null;
  guestName: string;
  checkIn: string; // ISO date string
  checkOut: string; // ISO date string
  source: BookingSource;
  status: BookingStatus;
  totalPrice: number | null;
  notes: string | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
  room?: Room;
  guest?: Guest | null;
}

export interface BookingWithRoom extends Booking {
  room: Room;
}

// Used for create/update forms
export interface BookingFormData {
  roomId: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  source: BookingSource;
  status: BookingStatus;
  totalPrice: string;
  notes: string;
}

// Source metadata for display
export const SOURCE_META: Record<
  BookingSource,
  { label: string; color: string; bgClass: string; textClass: string; borderClass: string }
> = {
  AIRBNB: {
    label: "Airbnb",
    color: "#FF385C",
    bgClass: "bg-rose-500",
    textClass: "text-rose-700",
    borderClass: "border-rose-400",
  },
  DIRECT: {
    label: "Direct",
    color: "#3B82F6",
    bgClass: "bg-blue-500",
    textClass: "text-blue-700",
    borderClass: "border-blue-400",
  },
  OFFLINE: {
    label: "Offline / Zalo",
    color: "#10B981",
    bgClass: "bg-emerald-500",
    textClass: "text-emerald-700",
    borderClass: "border-emerald-400",
  },
};

export const STATUS_META: Record<
  BookingStatus,
  { label: string; bgClass: string; textClass: string }
> = {
  CONFIRMED: { label: "Confirmed", bgClass: "bg-green-100", textClass: "text-green-800" },
  PENDING:   { label: "Pending",   bgClass: "bg-yellow-100", textClass: "text-yellow-800" },
  CANCELLED: { label: "Cancelled", bgClass: "bg-gray-100",   textClass: "text-gray-500" },
};
