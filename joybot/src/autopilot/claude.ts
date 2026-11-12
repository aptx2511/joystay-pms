import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Gọi Claude và trả về JSON parse sẵn
export async function askClaude<T = any>(options: {
  system: string;
  prompt: string;
  temperature?: number;
}): Promise<T> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    temperature: options.temperature ?? 0.5,
    system: options.system + "\n\nIMPORTANT: Chỉ trả về JSON thuần, không có markdown, không có ```json wrapper.",
    messages: [{ role: "user", content: options.prompt }],
  });

  const text = (response.content[0] as { text: string }).text.trim();

  // Strip markdown code block nếu có
  const clean = text.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(clean) as T;
}
