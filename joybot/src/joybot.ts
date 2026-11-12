import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";
import { buildSystemPrompt } from "./prompts/system";
import { toolDefinitions } from "./tools/definitions";
import { executeTool } from "./tools/executor";
import { store, SessionRow } from "./store";
import type { Ctx } from "./booking/service";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });
const MAX_STEPS = 8;

export interface JoyBotResponse {
  text: string;
  toolsUsed: string[];
  handoff: boolean;
}

const sessionId = (ctx: Ctx) => `${ctx.channel}:${ctx.userId}`;

async function loadSession(ctx: Ctx): Promise<SessionRow> {
  return (
    (await store.getSession(sessionId(ctx))) ?? {
      id: sessionId(ctx),
      channel: ctx.channel,
      channel_user_id: ctx.userId,
      messages: [],
      handoff: false,
    }
  );
}

export async function setHandoff(ctx: Ctx, on: boolean) {
  const s = await loadSession(ctx);
  s.handoff = on;
  await store.saveSession(s);
}

// Xử lý tuần tự theo từng khách để tránh 2 tin nhắn liên tiếp chạy song song
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => queues.get(key) === next && queues.delete(key));
  return next;
}

export function chat(ctx: Ctx, userMessage: string): Promise<JoyBotResponse> {
  return serial(sessionId(ctx), () => runTurn(ctx, userMessage));
}

async function runTurn(ctx: Ctx, userMessage: string): Promise<JoyBotResponse> {
  const session = await loadSession(ctx);
  const toolsUsed: string[] = [];

  // Gộp tin khách liên tiếp (vd khách gửi nhiều tin khi bot đang im)
  const last = session.messages.at(-1);
  if (last?.role === "user" && typeof last.content === "string") last.content += `\n${userMessage}`;
  else session.messages.push({ role: "user", content: userMessage });

  if (session.handoff) {
    await store.saveSession(session);
    return { text: "", toolsUsed, handoff: true };
  }

  const msgs: Anthropic.MessageParam[] = [...session.messages];
  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 1500,
      system: buildSystemPrompt(),
      tools: toolDefinitions,
      messages: msgs,
    });

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!toolUses.length) {
      finalText = text;
      break;
    }
    msgs.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      // tuần tự: create_hold không được chạy song song
      toolsUsed.push(t.name);
      results.push({ type: "tool_result", tool_use_id: t.id, content: await executeTool(t.name, t.input as any, ctx) });
    }
    msgs.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "Xin lỗi, mình cần kiểm tra thêm — chủ Joystay sẽ nhắn bạn ngay.";

  // Lưu: giữ lại tool_use/tool_result để bot nhớ mã đặt phòng, giá đã báo
  session.messages = [...msgs, { role: "assistant", content: finalText }];
  const fresh = await store.getSession(session.id);
  session.handoff = fresh?.handoff ?? session.handoff;
  await store.saveSession(session);

  return { text: finalText, toolsUsed, handoff: session.handoff };
}
