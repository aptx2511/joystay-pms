# JOYSTAY MASTER CONTEXT

> **Luôn đọc và cập nhật file này trước/sau mỗi lần làm việc lớn.**

---

## 1. Tổng quan dự án

**Joystay PMS** — Property Management System cho Joystay Boutique Homestay  
**URL production**: https://joystay-pms.vercel.app/  
**Stack**: Next.js 14 (App Router) + Prisma + PostgreSQL + Tailwind CSS  
**Deploy**: Vercel  
**Repo**: `c:\Users\PC\joystay-pms` | branch `main`

---

## 2. Các phòng hiện có

| Phòng | ID DB | Diện tích | Giá ngày thường | Giá cuối tuần |
|-------|-------|-----------|-----------------|---------------|
| The Matcha Bath Loft | (seed: 401) | ~50 m² | 1,490,000 đ | 1,590,000 đ |
| (thêm phòng qua Settings → Thêm phòng mới) | | | | |

---

## 3. Kiến trúc code

```
src/
├── app/
│   ├── layout.tsx          — Root layout: Sidebar (desktop) + BottomNav (mobile) + pb-16 md:pb-0
│   ├── globals.css         — Gantt cell CSS, badge styles, scrollbar
│   ├── page.tsx            — Dashboard: GanttCalendar + BookingForm
│   ├── bookings/page.tsx   — Danh sách booking: card (mobile) / table (desktop)
│   ├── revenue/page.tsx    — Báo cáo doanh thu theo tháng/phòng/kênh
│   ├── attendance/page.tsx — Chấm công cô giúp việc (75k/tiếng, max 24h/ngày)
│   ├── settings/page.tsx   — Channel Manager: iCal import/export, giá phòng, tạo phòng
│   └── api/
│       ├── bookings/       — GET/POST/PUT/DELETE bookings
│       ├── rooms/          — GET/POST/PATCH rooms
│       ├── revenue/        — GET revenue stats
│       ├── shifts/         — GET/POST/DELETE attendance shifts
│       ├── ical/sync/      — POST: sync Airbnb/Booking.com/Agoda/Traveloka → DB
│       ├── ical/export/    — GET [roomId].ics: export lịch phòng ra iCal
│       └── availability/   — GET: check available rooms for date range
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx     — Desktop sidebar (hidden md:flex), nav + booking sources legend
│   │   ├── BottomNav.tsx   — Mobile bottom nav bar (flex md:hidden), 5 items
│   │   └── Header.tsx      — Page header responsive: title truncate, subtitle hidden <sm
│   ├── calendar/
│   │   └── GanttCalendar.tsx — Gantt 30 ngày, sticky room label, booking blocks clickable
│   └── bookings/
│       └── BookingForm.tsx — Modal: bottom sheet mobile (rounded-t-2xl), centered desktop
├── lib/
│   ├── prisma.ts           — Prisma client singleton
│   └── utils.ts            — nightCount(), formatPrice()
└── types/index.ts          — Booking, Room, SOURCE_META, STATUS_META, calcAutoPrice
```

---

## 4. Database (Prisma)

**Models**: `Room`, `Booking`, `Shift`

**Room fields**: `id, name, size, pricePerNight, weekendPricePerNight, icalUrl (Airbnb), bookingIcalUrl, agodaIcalUrl, travelokaIcalUrl`

**Booking fields**: `id, roomId, guestName, checkIn, checkOut, source (AIRBNB/DIRECT/OFFLINE), status (CONFIRMED/PENDING/CANCELLED), totalPrice, notes, externalId`

**Shift fields**: `id, workDate, hours, note` — chấm công cô giúp việc

---

## 5. Business Logic quan trọng

- **Giá tự tính**: `calcAutoPrice()` trong `types/index.ts` — tính theo ngày thường vs cuối tuần (T6-T7), Airbnb trừ 3% commission
- **iCal sync**: Import từ Airbnb/Booking.com/Agoda/Traveloka, mapping source → `AIRBNB` hoặc `DIRECT` hoặc `OFFLINE`
- **iCal export**: Endpoint `/api/ical/[roomId].ics` → guest calendar view
- **Chấm công**: Click = +1h, giữ 600ms = xoá ngày, rate 75,000đ/tiếng

---

## 6. Responsive / Mobile Design (cập nhật 2026-11-05)

**Breakpoint**: `md` = 768px (Tailwind default)

| Component | Mobile (<md) | Desktop (≥md) |
|-----------|-------------|----------------|
| Sidebar | `hidden` | `flex flex-col w-60` |
| BottomNav | `flex` (fixed bottom) | `hidden` |
| Main padding | `pb-16` (tránh BottomNav) | `pb-0` |
| Header subtitle | `hidden` | `block` |
| New Booking btn | icon only | icon + text |
| Bookings view | Card list | Table 8 cột |
| BookingForm | Bottom sheet (rounded-t-2xl, từ dưới lên) | Centered dialog |
| GanttCalendar | Horizontal scroll, toolbar compact | Full toolbar |

---

## 7. Các kênh đặt phòng

| Source | Label | Màu | iCal |
|--------|-------|-----|------|
| AIRBNB | Airbnb | rose/đỏ | Import từ Airbnb |
| DIRECT | Direct | blue/xanh | Booking.com iCal |
| OFFLINE | Offline/Zalo | emerald/xanh lá | Agoda, Traveloka, manual |

---

## 8. Lịch sử thay đổi lớn

| Ngày | Thay đổi |
|------|----------|
| 2026-11-05 | Mobile responsive: BottomNav, Sidebar hidden mobile, card view bookings, bottom sheet form |
| (trước) | Thêm iCal sync Booking.com, Agoda, Traveloka |
| (trước) | Thêm trang Revenue, Attendance |
| (trước) | Thêm create-room API + form |
| (trước) | Seed phòng The Matcha Bath Loft |
