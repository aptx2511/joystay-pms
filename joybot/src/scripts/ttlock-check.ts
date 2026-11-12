/**
 * Kiểm tra kết nối TTLock: đăng nhập + liệt kê khoá + đối chiếu bảng ROOM_LOCKS.
 * Chạy: npx tsx src/scripts/ttlock-check.ts
 * Thêm  --test-room 401    để tạo thử 1 mã TỰ SINH ~2 tiếng cho phòng đó (chỉ in ra, không gửi ai).
 * Thêm  --test-custom 401  để thử đặt 1 mã 4 SỐ TỰ CHỌN ~2 tiếng qua bộ phát (chỉ in ra).
 */
import { customPasscode, listGateways, listLocks, locksOfGateway, periodPasscode, ttlockConfigured } from "../locks/ttlock";
import { ROOM_LOCKS, ENTRANCE_LOCKS } from "../locks/doors";
import { config } from "../config";

(async () => {
  if (!ttlockConfigured()) {
    console.error("❌ Thiếu TTLOCK_CLIENT_ID / TTLOCK_CLIENT_SECRET / TTLOCK_USERNAME / TTLOCK_PASSWORD trong .env");
    process.exit(1);
  }
  console.log(`Máy chủ: ${config.ttlock.baseUrl} · tài khoản: ${config.ttlock.username}`);
  const locks = await listLocks();
  console.log(`✅ Đăng nhập OK — thấy ${locks.length} khoá:`);
  for (const l of locks) console.log(`  ${l.lockId}\t${l.lockAlias || l.lockName}\tpin ${l.electricQuantity ?? "?"}%\tgateway ${l.hasGateway ? "có" : "không"}`);
  const ids = new Set(locks.map((l) => l.lockId));
  const expected = [...Object.entries(ROOM_LOCKS).map(([r, id]) => [`phòng ${r}`, id] as const), ...ENTRANCE_LOCKS.map((e) => [e.name, e.lockId] as const)];
  for (const [label, id] of expected) console.log(`${ids.has(id) ? "  ✓" : "  ✗ KHÔNG THẤY"} ${label} → ${id}`);

  // Bộ phát và các khoá mỗi bộ phát phủ sóng
  const gws = await listGateways();
  console.log(`\n📡 ${gws.length} bộ phát:`);
  const covered = new Set<number>();
  for (const g of gws) {
    const ls = await locksOfGateway(g.gatewayId).catch(() => []);
    ls.forEach((l) => covered.add(l.lockId));
    console.log(`  ${g.gatewayName} — ${g.isOnline ? "online" : "OFFLINE"} — phủ ${ls.length} khoá: ${ls.map((l) => `${l.lockAlias || l.lockName}${l.rssi ? ` (sóng ${l.rssi})` : ""}`).join(", ")}`);
  }
  console.log(`\n🔎 Khoá cần cho khách:`);
  for (const [label, id] of expected) {
    const lock = locks.find((l) => l.lockId === id);
    console.log(`  ${covered.has(id) ? "✅ có bộ phát " : "⚠️ CHƯA có bộ phát"}  ${label} (${lock?.lockAlias ?? id}, pin ${lock?.electricQuantity ?? "?"}%)`);
  }

  const j = process.argv.indexOf("--test-custom");
  if (j > 0) {
    const room = process.argv[j + 1];
    const lockId = ROOM_LOCKS[room];
    if (!lockId) throw new Error(`Không có khoá cho phòng ${room}`);
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const start = Date.now();
    const r = await customPasscode(lockId, code, start, start + 2 * 3_600_000, "TEST Claude 4so");
    console.log(`\n🔑 Mã 4 số tự chọn phòng ${room}: ${r.passcode} (id ${r.passcodeId}) — hiệu lực ~1–2 tiếng. Ra cửa thử: chạm màn hình → ${r.passcode} → #`);
  }

  const i = process.argv.indexOf("--test-room");
  if (i > 0) {
    const room = process.argv[i + 1];
    const lockId = ROOM_LOCKS[room];
    if (!lockId) throw new Error(`Không có khoá cho phòng ${room}`);
    const start = Date.now();
    const r = await periodPasscode(lockId, start, start + 2 * 3_600_000, "TEST Claude");
    console.log(`🔑 Mã thử phòng ${room}: ${r.passcode} (id ${r.passcodeId}) — hiệu lực tới ~2 tiếng tới`);
  }
})().catch((e) => { console.error("❌", e.response?.data ?? e.message); process.exit(1); });
