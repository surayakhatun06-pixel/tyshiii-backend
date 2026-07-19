// ============================================================
// RUN THIS ONCE, ON YOUR OWN COMPUTER — NOT ON RENDER.
//
// What it does: logs into your real Telegram account (the one
// that owns the channel) and prints out a long "session string".
// That string lets the backend act as your logged-in account
// forever after, without ever asking for a login code again.
// ============================================================

const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");
require("dotenv").config();

const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  console.error(
    "Missing TELEGRAM_API_ID or TELEGRAM_API_HASH.\n" +
    "Create a file named .env in this folder (copy .env.example) and fill those two in first."
  );
  process.exit(1);
}

(async () => {
  console.log("Starting Telegram login...\n");

  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Enter your phone number (with country code, e.g. +8801XXXXXXXXX): "),
    password: async () => await input.text("Enter your 2FA password (leave blank and press Enter if you don't have one): "),
    phoneCode: async () => await input.text("Enter the login code Telegram just sent you: "),
    onError: (err) => console.error(err),
  });

  console.log("\nLogged in successfully!\n");
  console.log("=========== COPY EVERYTHING BELOW THIS LINE ===========");
  console.log(client.session.save());
  console.log("=========== COPY EVERYTHING ABOVE THIS LINE ===========\n");
  console.log("Paste that whole string as TELEGRAM_SESSION in Render's environment variables.");
  console.log("Keep it secret — anyone with this string can log in as your Telegram account.");

  await client.disconnect();
  process.exit(0);
})();
