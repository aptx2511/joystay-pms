# JoyBot 🤖 — Joystay AI Agent

AI Conversational & Operator Agent cho Joystay Vietnam.
Tư vấn phòng, đặt lịch, và tự động tạo mã khóa cửa Sciener.

## Stack
- **LLM**: Claude Opus 4.6 (`claude-opus-4-6`) via Anthropic SDK
- **Tool Use**: checkAvailability, getPricing, createBooking, generateScienerPasscode
- **APIs**: Joystay PMS + Sciener Smart Lock
- **Runtime**: Node.js + TypeScript + Express

## Setup

```bash
cp .env.example .env
# Fill in: ANTHROPIC_API_KEY, SCIENER_*, PMS_*
# Update ROOM_LOCK_MAP in src/config.ts with real Sciener lockIds

npm install
```

## Run

```bash
# Development (with hot reload)
npm run dev

# Test in CLI
npm run test:bot

# Production build
npm run build && npm start
```

## API

### POST /chat
```json
{
  "sessionId": "user-123",
  "message": "Có phòng trống ngày 5-7/4 không?"
}
```
Response:
```json
{
  "sessionId": "user-123",
  "reply": "Dạ có bạn ơi! Pop Art Suite và Neon Dreams còn trống...",
  "toolsUsed": ["checkAvailability"],
  "usage": { "inputTokens": 1234, "outputTokens": 256 }
}
```

## Sciener Configuration

1. Đăng nhập Sciener.cn → Tạo application → Lấy `clientId` + `clientSecret`
2. OAuth để lấy `accessToken` cho tài khoản lock manager
3. Vào từng lock → Copy `lockId` → Điền vào `ROOM_LOCK_MAP` trong `src/config.ts`

## Architecture

Xem [ARCHITECTURE.md](ARCHITECTURE.md) để hiểu luồng data và tool call sequence.
