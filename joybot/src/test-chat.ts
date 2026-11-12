/**
 * Interactive CLI test for JoyBot
 * Run: tsx src/test-chat.ts
 */
import "dotenv/config";
import * as readline from "readline";
import { chat } from "./joybot";

const SESSION_ID = `test-${Date.now()}`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log(`
╔══════════════════════════════════════════╗
║   🤖 JoyBot CLI Test — Joystay Vietnam   ║
║   Session: ${SESSION_ID.slice(0, 20)}...  ║
║   Type "exit" to quit                    ║
╚══════════════════════════════════════════╝
`);

async function askQuestion(): Promise<void> {
  rl.question("\n👤 You: ", async (input: string) => {
    if (input.toLowerCase() === "exit") {
      console.log("\n🤖 JoyBot: Tạm biệt bạn! Hẹn gặp lại tại Joystay 🏠✨");
      rl.close();
      return;
    }

    if (!input.trim()) {
      askQuestion();
      return;
    }

    process.stdout.write("\n🤖 JoyBot: ");

    try {
      const result = await chat({ channel: "test", userId: SESSION_ID }, input);

      console.log(result.text);

      if (result.toolsUsed.length > 0) {
        console.log(`\n  [Tools used: ${result.toolsUsed.join(", ")}]`);
      }
    } catch (err) {
      console.error("Error:", err);
    }

    askQuestion();
  });
}

// Kick off with a greeting
(async () => {
  const greeting = await chat({ channel: "test", userId: SESSION_ID }, "Xin chào!");
  console.log("🤖 JoyBot:", greeting.text);
  askQuestion();
})();
