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

## 18/11/2026 – Agoda double booking (phòng 201)
- Nguyên nhân: Agoda (Calendar connections) chỉ nhập iCal của Airbnb cho từng phòng, KHÔNG nhập lịch PMS → booking trực tiếp (DIRECT) và Booking.com không bao giờ đóng phòng trên Agoda. Khang (DIRECT 201, 18–23/11) không chặn Agoda → JINGHAO SUN (Agoda 1799506598, 18–19/11) đặt trùng.
- Mapping Agoda room type ↔ phòng: 1600768859 Superior Queen = 301 Tropical · 1600768860 Queen Room = 101 Cozy · 1600768861 Deluxe Queen = 201 Midnight · 1600768862 Deluxe King = 202 Pop Art · 1600768863 Deluxe studio = 302 Parisian (đang nhập iCal listing B&W 1638422674685971390, không phải listing Parisian chính) · 1651287359 Suite Loft = 401 Matcha.
- Đã đóng tay trên Agoda: 201 19–22/11 & 31/12–2/1; 202 20–22/11; 101 24–26/12 & 31/12–2/1; 301 31/12–2/1.
- Agoda từ chối link iCal PMS ("Invalid calendar"). Đã thêm chế độ ?plain=1 cho /ical/<roomId>.ics (ASCII, giống Airbnb) – commit e45c2ae – để thử nhập lại.
- 18/11 23:00: Agoda phòng 1600768863 (302 Parisian) đã thêm lịch "Airbnb Parisian" (listing chính 1806587025194224911), giữ thêm lịch B&W cho tới khi gỡ listing B&W. PMS 302 đã đọc đúng listing Parisian chính. Booking.com chưa kiểm tra (phiên đăng nhập hết hạn).
- 18/11 23:15: Đã thử: Agoda NHẬN link iCal công khai của Google Calendar (đã xoá lịch thử). Giải pháp không cần máy tính: Apps Script "Joystay – Lịch PMS cho Agoda" (tài khoản hung251197@gmail.com) mỗi 15 phút chép lịch PMS (/ical/<roomId>.ics?plain=1, không tên khách) vào 6 Google Calendar công khai "Joystay PMS – <phòng>", Agoda nhập các link .ics đó. Chờ chủ bấm Run setup() + cấp quyền, sau đó dán 6 link vào Agoda Calendar connections.
- JINGHAO (Agoda 1799506598) đã chuyển sang 202 Pop Art trong PMS (Khang ở 201).
- 18/11 23:16: XONG cầu lịch. Apps Script đã chạy setup() (trigger sync mỗi 15 phút). 6 lịch Google "Joystay PMS – <phòng>" đã gắn vào 6 room type Agoda với tên "Joystay PMS", cả 6 đồng bộ thành công. Agoda giờ đọc: Airbnb + Joystay PMS (302 thêm Airbnb Parisian). Các ngày đóng tay hôm nay (Closed) vẫn giữ – nếu huỷ booking phải mở tay lại.
- PMS /settings giờ hiện "Lịch cho Agoda (Google)" từng phòng + giờ đồng bộ gần nhất (AppSetting agoda_gcal:<roomId>, gcal_bridge_seen ghi khi Apps Script đọc ?plain=1). JoyBot gcalBridgeTick cảnh báo Telegram nếu quá 1 tiếng không đồng bộ.
