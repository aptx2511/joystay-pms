# JoyBot — Bot đặt phòng tự động (tư vấn → giữ chỗ → cọc 50% → chốt → khóa lịch PMS)

## Luồng
1. Khách nhắn Zalo OA / Messenger / Instagram / WhatsApp → `/webhook/zalo` hoặc `/webhook/meta`.
2. Bot (Claude) hỏi ngày + số khách → `search_rooms`: đồng bộ iCal OTA ngay → hỏi PMS phòng trống → tính giá từ `ROOMS_JSON`.
3. Khách chốt + cho tên, SĐT → `create_hold`: PMS tạo booking **PENDING** (lịch bị khóa ngay, xuất sang OTA qua iCal), gửi **QR VietQR** cọc 50%, nội dung CK = mã `JOYxxxx`, giữ chỗ 30 phút.
4. Xác nhận tiền:
   - Giai đoạn A: Telegram báo chủ → bấm **✅ Đã nhận cọc**.
   - Giai đoạn B: SePay gọi `/webhook/sepay` → khớp mã + đủ tiền → tự chốt.
5. Chốt: PMS → **CONFIRMED**, nhắn khách xác nhận, báo chủ.
6. Quá 30 phút chưa cọc → PMS **CANCELLED**, mở lại lịch, nhắn khách.
7. Mỗi 15 phút: kéo lịch Airbnb/Booking/Agoda về PMS (thay cho cron 1 lần/ngày).

Bot không bao giờ dùng dữ liệu giả: PMS lỗi → xin lỗi khách, báo chủ qua Telegram, chuyển người.

## Cài đặt (làm 1 lần)
1. **Supabase** → SQL Editor → chạy `sql/001_joybot_booking.sql`.
2. **Phòng Q3 trong PMS**: đảm bảo 6 phòng Q3 đã có trong PMS, lấy `id` từ `https://joystay-pms.vercel.app/api/rooms`.
3. **ROOMS_JSON** (1 dòng), ví dụ:
   ```json
   [{"pmsRoomId":"<id>","name":"Pop Art","concept":"Pop Art","sizeM2":25,"maxGuests":2,"hasKitchen":true,"basePrice":850000,"weekendPrice":900000,"active":true,"description":"Mảng màu khối, đồ vật retro."}]
   ```
   Phòng thiếu giá hoặc `active:false` → bot không nhận đặt, chuyển chủ.
4. **Railway — tạo SERVICE MỚI cho JoyBot** (đừng deploy chung service với content-bot nữa):
   trong thư mục `joystay-joybot`: `railway link` → chọn project → tạo service `joybot` → `railway up --service joybot`.
   Điền biến môi trường theo `.env.example` (số tài khoản ngân hàng, token: CHỦ TỰ ĐIỀN). Đặt `PUBLIC_URL` = domain của service mới.
5. **Telegram**: BotFather → tạo bot mới (vd `JoystayBookingBot`) → token vào `JOYBOT_TELEGRAM_TOKEN`; nhắn bot 1 tin rồi lấy chat id của anh → `JOYBOT_TELEGRAM_CHAT_ID`. Webhook tự đặt khi khởi động.
6. **Messenger + Instagram**: Meta for Developers → app → sản phẩm Messenger (+ Instagram) → Webhook URL `PUBLIC_URL/webhook/meta`, Verify token = `META_VERIFY_TOKEN`, đăng ký trường `messages`; lấy Page Access Token (Page Joystay, IG đã liên kết Page). Muốn trả lời mọi khách (không chỉ admin app) cần quyền `pages_messaging` / `instagram_manage_messages` ở mức Advanced (App Review).
7. **WhatsApp**: WhatsApp Business Platform → số điện thoại + token vĩnh viễn (System User) → Webhook cùng URL `PUBLIC_URL/webhook/meta`, đăng ký `messages`. Lưu ý: chỉ trả lời tự do trong 24 giờ kể từ tin cuối của khách.
8. **Zalo OA**: developers.zalo.me → app liên kết OA → Webhook `PUBLIC_URL/webhook/zalo`, bật sự kiện `user_send_text` → lấy access token + refresh token (bot tự làm mới và lưu token mới vào Supabase). Kiểm tra quy định hiện hành của Zalo về thời hạn gửi tin tư vấn sau khi khách nhắn.
9. **(Giai đoạn B) SePay**: liên kết tài khoản nhận tiền → Webhook `PUBLIC_URL/webhook/sepay`, xác thực **API Key** = `SEPAY_API_KEY`.

## Thử nhanh (không cần kênh nào)
```bash
curl -X POST $PUBLIC_URL/chat -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json" \
  -d '{"userId":"thu1","message":"Còn phòng 20-22/11 cho 2 người không?"}'
```
Kênh `test` tạo booking THẬT trên PMS — hủy bằng nút ❌ trên Telegram sau khi thử.

## Lệnh Telegram của chủ
| Lệnh / nút | Tác dụng |
|---|---|
| ✅ Đã nhận cọc JOYxxxx | Chốt: PMS CONFIRMED + nhắn khách |
| ❌ Hủy | Hủy giữ chỗ, mở lại lịch |
| `/tay kênh:id` | Bot im lặng với khách đó, anh tự xử lý |
| `/bot kênh:id` | Bật lại bot |
| `/tl kênh:id nội dung` | Nhắn khách thay mặt Joystay qua đúng kênh |

## Còn để sau
- Gửi mã PIN tự động (Sciener — cần lockId thật). Hiện chủ tự gửi.
- Nhắc khách trả 50% còn lại trước ngày nhận phòng.
- **Bảo mật PMS**: API PMS chưa có khóa — ai biết URL đều tạo/sửa/xóa được booking. Cần thêm kiểm tra API key (và đăng nhập cho trang quản trị) rồi điền `PMS_API_KEY`.
- Độ trễ OTA: Airbnb/Booking/Agoda tự đọc lịch PMS theo chu kỳ của họ (thường vài giờ) → booking trực tiếp sát ngày vẫn có rủi ro trùng; nên chặn tay trên OTA khi có booking trong 24h tới.

Code cũ có dữ liệu giả đã chuyển vào `legacy/` (không còn được dùng).
