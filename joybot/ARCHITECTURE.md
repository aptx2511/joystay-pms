# JoyBot Architecture

## Data Flow

```
Customer (Airbnb / Zalo / Website)
         │
         ▼
┌─────────────────────┐
│   Channel Adapter   │  POST /webhook/zalo
│   (Express.js)      │  POST /webhook/website
│                     │  POST /chat  (universal)
└────────┬────────────┘
         │ sessionId + message
         ▼
┌─────────────────────────────────────────────────────┐
│                  JoyBot Engine                       │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  System Prompt (Thổ Địa Sài Gòn persona)     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  Claude Opus 4.6 (claude-opus-4-6)           │   │
│  │  + Tool Use (Agentic Loop)                   │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  Session Store (in-memory / Redis)           │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────┬──────────────────────────────────┘
                   │ tool calls
          ┌────────┴─────────┐
          ▼                  ▼
┌──────────────────┐  ┌──────────────────────┐
│  Joystay PMS     │  │  Sciener Smart Lock  │
│  API             │  │  API                 │
│                  │  │                      │
│ checkAvailability│  │ generatePasscode     │
│ getPricing       │  │ deletePasscode       │
│ createBooking    │  │                      │
└──────────────────┘  └──────────────────────┘
```

## Tool Call Sequence (Booking Flow)

```
Guest: "Cho mình đặt Pop Art Suite ngày 5-7/4 được không?"
  │
  ▼
JoyBot → checkAvailability({ checkIn: "2025-04-05", checkOut: "2025-04-07", roomSlug: "pop-art-suite" })
  │           └─► PMS API returns: available=true
  ▼
JoyBot → getPricing({ roomSlug: "pop-art-suite", checkIn: "2025-04-05", checkOut: "2025-04-07" })
  │           └─► Returns: 2 nights × 1,500,000đ + 200,000đ = 3,200,000đ
  ▼
JoyBot: "Pop Art Suite còn trống ngày đó bạn ơi! 2 đêm sẽ là 3.200.000đ
         (đã bao gồm phí dọn phòng). Bạn xác nhận đặt không?"
  │
Guest: "Xác nhận đặt, tên Nguyễn Văn A, SĐT 0901234567"
  │
  ▼
JoyBot → createBooking({ roomSlug: "pop-art-suite", checkIn: ..., checkOut: ...,
                          guestName: "Nguyễn Văn A", guestPhone: "0901234567", adults: 1 })
  │           └─► PMS returns: { bookingId: "JOY-xxx", confirmationCode: "JST123456" }
  ▼ (auto, no user prompt needed)
JoyBot → generateScienerPasscode({ bookingId: "JOY-xxx", roomSlug: "pop-art-suite",
                                    checkIn: "2025-04-05T14:00:00+07:00", ... })
  │           └─► Sciener returns: { passcode: "482917", validFrom: ..., validTo: ... }
  ▼
JoyBot: "✅ Đặt phòng thành công! Mã xác nhận: JST123456
         🔑 Mã cửa: 482917 (hiệu lực 5/4 lúc 14:00 đến 7/4 lúc 12:00)
         📍 Địa chỉ: [địa chỉ chi tiết]
         Hẹn gặp bạn tại Joystay! 🎨"
```

## Tool Definitions

| Tool | When Called | Side Effects |
|------|------------|--------------|
| `checkAvailability` | Guest asks about dates | Read-only PMS query |
| `getPricing` | Guest asks about price | Read-only PMS query |
| `createBooking` | Guest CONFIRMS booking | Writes to PMS, blocks calendar |
| `generateScienerPasscode` | Auto after createBooking success | Creates lock code in Sciener |

## Environment Variables

```
ANTHROPIC_API_KEY     → Claude API access
PMS_BASE_URL          → https://joystay-pms.vercel.app/api
PMS_API_KEY           → PMS authentication
SCIENER_CLIENT_ID     → Sciener app client ID
SCIENER_CLIENT_SECRET → Sciener app secret (for MD5 signing)
SCIENER_ACCESS_TOKEN  → OAuth access token for the lock account
```

## Session Management
- Each guest gets a `sessionId` (UUID or channel-derived: `zalo-{userId}`, `web-{visitorId}`)
- Full conversation history is kept in memory per session
- Sessions auto-pruned after 24h of inactivity
- For production: replace in-memory Map with Redis

## Extending JoyBot

To add a new channel (e.g., Facebook Messenger):
1. Add `POST /webhook/facebook` in `src/index.ts`
2. Parse FB webhook format → extract `message.text` + `sender.id`
3. Call `chat(sessionId, message)` and send reply via FB Send API

To add a new tool (e.g., `sendEmailConfirmation`):
1. Add definition to `src/tools/definitions.ts`
2. Add implementation to `src/tools/pms.ts` or a new file
3. Add case to `src/tools/executor.ts`
