import "dotenv/config";
import http from "http";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage } from "teleproto/events/index.js";
import { Api } from "teleproto/tl/index.js";
import { FloodWaitError } from "teleproto/errors/index.js";
import { getSystemStatus, updateSystemStatus } from "./utils/database.js";
import { getDictionaryResponse } from "./utils/dictionaryHandler.js";
import { getAIResponse, checkAndRecoverGemini, testGeminiConnection } from "./utils/aiHandler.js";
import { detectTone, detectFileTone } from "./utils/toneDetector.js";
import {
  getUserFullInfo,
  checkUserLimit,
  incrementUserMessage,
  setUserTone,
  updateUserBehavior,
  addReceivedFile,
  saveDailyMessageMemory,
  getDailyMessages,
  updateBehaviorProfile,
  adaptPersonalityToBehavior,
  extractUserInterests,
  saveRecentMessage,
  saveConversationPair,
  getConversationPairs,
} from "./utils/userManager.js";

import {
  generateDailyDictionaryEntries,
  reloadDictionary,
} from "./utils/dictionaryHandler.js";
import { runNightlyPersonalityUpdate } from "./utils/personalityManager.js";

// ==================== Configuration ====================
const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.SESSION_STRING;
const ownerId = Number(process.env.OWNER_ID);
const dailyMessageLimit = Number(process.env.DAILY_MESSAGE_LIMIT) || 500;
const globalCooldownMinutes = Number(process.env.GLOBAL_COOLDOWN_MINUTES) || 5;
const userLimitMessages = Number(process.env.USER_LIMIT_MESSAGES) || 200;
const userLimitHours = Number(process.env.USER_LIMIT_HOURS) || 2;

if (!apiId || !apiHash || !sessionString) {
  console.error("TELEGRAM_API_ID, TELEGRAM_API_HASH, SESSION_STRING  is empty");
  process.exit(1);
}

// ==================== Message Templates ====================
// Message templates
const WELCOME_MESSAGES = [
  "سلام، خوبی؟",
  "چطوری؟",
  "سلام",
  "چه خبر؟",
  "درود، خوبی؟",
];

const LIMIT_MESSAGES = [
  "ممنون، الان نمی‌تونم جواب بدم. بعداً می‌گم",
  "حد پیام‌هاست، بعداً ادامه میدیم",
  "الان دستیم پره، بعداً حرف می‌زنیم",
  "باید بریم، بعداً بهت پیام میدم",
  "محدودیت رسید، چند ساعته دیگه میام",
];

// ==================== Helper Functions ====================
// Random selection from array
function pickRandom(list) {
  if (!list || list.length === 0) return "";
  return list[Math.floor(Math.random() * list.length)];
}

// Convert various numeric types to number
function toNumber(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof value.toJSNumber === "function") return value.toJSNumber();
  if (typeof value.valueOf === "function") {
    const n = Number(value.valueOf());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ==================== Bot Detection ====================
// Bot user detection with caching
const botUserCache = new Map();
const BOT_CACHE_TTL = 10 * 60 * 1000;

async function isBotUser(userId) {
  if (botUserCache.has(userId)) {
    const entry = botUserCache.get(userId);
    if (Date.now() - entry.time < BOT_CACHE_TTL) return entry.isBot;
    botUserCache.delete(userId);
  }
  try {
    const entity = await client.getEntity(userId);
    const isBot = !!(entity && entity.bot);
    botUserCache.set(userId, { isBot, time: Date.now() });
    return isBot;
  } catch (error) {
    return false;
  }
}

// ==================== HTTP Server ====================
// HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === "/healthcheck") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("🤖 Userbot is running!");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ HTTP server running on port ${PORT} for health checks`);
});

// ==================== Telegram Client ====================
// Telegram client initialization
const client = new TelegramClient(
  new StringSession(sessionString),
  apiId,
  apiHash,
  {
    connectionRetries: 5,
    shouldReconnect: true,
  },
);

await client.start();

console.log("✅ Userbot is running successfully");
const me = await client.getMe();
console.log(`👤 User : ${me.firstName} (${me.id})`);

// Initialize dictionary and test AI connection
await reloadDictionary();
await testGeminiConnection();

// ==================== Global Cooldown ====================
// Global cooldown helpers
async function isGlobalCooldownActive() {
  try {
    const status = await getSystemStatus();
    if (!status.globalCooldownUntil) return false;
    return new Date() < status.globalCooldownUntil;
  } catch (error) {
    console.warn("⚠️ cooldown check failed, treating as inactive:", error.message || error);
    return false;
  }
}

async function activateGlobalCooldown() {
  const cooldownUntil = new Date(Date.now() + globalCooldownMinutes * 60 * 1000);
  await updateSystemStatus({ globalCooldownUntil: cooldownUntil });
  console.log(`⏳ sleep all account until ${cooldownUntil.toLocaleString("fa-IR")} is ON`);
}

// ==================== Message Sending ====================
// Safe message sending with FloodWait handling
async function safeSend(msg, text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await msg.reply({ message: text });
      return true;
    } catch (error) {
      if (error instanceof FloodWaitError) {
        const wait = Math.min(error.seconds || 5, 60);
        console.warn(`⚠️ flood wait ${wait}s، retrying in ${wait}s...`);
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        continue;
      }
      console.error("❌ error to send message:", error);
      return false;
    }
  }
  return false;
}

// Send random music from configured channel
async function sendMusicFromChannel(chatId) {
  try {
    const channelId = process.env.MUSIC_CHANNEL_ID;
    if (!channelId) return false;

    const result = await client.api.messages.search({
      peer: channelId,
      q: "",
      filter: new Api.InputMessagesFilterMusic(),
      limit: 50,
    });

    const musicMessages = result.messages || [];
    if (musicMessages.length === 0) return false;

    const musicMsg = musicMessages[Math.floor(Math.random() * musicMessages.length)];
    await client.forwardMessages(chatId, {
      messages: [musicMsg.id],
      fromPeer: channelId,
    });
    return true;
  } catch (error) {
    console.error("❌ error send music:", error);
    return false;
  }
}

// ==================== Main Message Handler ====================
// Main message handler
client.addEventHandler(async (event) => {
  try {
    const msg = event.message;
    if (!msg) return;

    const chatId = toNumber(msg.chatId ?? msg.chat?.id ?? msg.peerId);
    const senderPeer = msg.fromId;

    if (senderPeer?.className !== "PeerUser") return;

    const userId = toNumber(senderPeer.userId);

    if (chatId === undefined || userId === undefined) {
      console.warn("⚠️ chatId or userId is invalid");
      return;
    }

    // Ignore bot messages
    if (await isBotUser(userId)) return;
    if (!msg.text && !msg.media && !msg.sticker) return;

    // Owner message triggers global cooldown
    if (userId === ownerId) {
      await activateGlobalCooldown();
      console.log(`🔔 owner is typing, sleeping all account for ${globalCooldownMinutes} minutes is ON`);
      return;
    }

    // Group mention check
    if (msg.isPrivate !== true) {
      const username = me?.username;
      const text = msg.text || "";
      let isMentioned = false;
      if (username && msg.entities) {
        for (const entity of msg.entities) {
          if (entity instanceof Api.MessageEntityMention || entity instanceof Api.MessageEntityMentionName) {
            const mentionText = text.substring(entity.offset, entity.offset + entity.length);
            if (mentionText === `@${username}`) {
              isMentioned = true;
              break;
            }
          }
        }
      }
      if (!isMentioned && !msg.mentioned) return;
    }

    // Global cooldown check
    if (await isGlobalCooldownActive()) {
      console.log(`⏳ sleeping all account is ON, user ${userId} Ignored`);
      return;
    }

    // Load user info
    let userInfo = await getUserFullInfo(client, userId, chatId);
    if (!userInfo) {
      console.warn(`⚠️ could not load user ${userId} data, replying with fallback`);
      userInfo = { messageCount: 0, bio: "", photoAnalysis: "", previousPhotoAnalysis: "", previousBio: "", behaviorCounts: {}, behaviorProfile: {}, personalityAdaptation: {}, profileChanged: false, bioChanged: false, lastInteraction: null };
    }

    // Daily message limit check
    let status = null;
    let totalDailyMessages = 0;
    try {
      status = await getSystemStatus();
      const now = new Date();
      if (now >= status.dailyResetTime) {
        await updateSystemStatus({ totalDailyMessages: 0, dailyResetTime: new Date(now.setDate(now.getDate() + 1)), dictionaryMode: false, geminiQuotaExceeded: false });
        status = await getSystemStatus();
      }
      totalDailyMessages = status.totalDailyMessages || 0;
    } catch (error) {
      console.warn("⚠️ system status check failed, ignoring daily limit:", error.message || error);
    }

    if (totalDailyMessages >= dailyMessageLimit) {
      await safeSend(msg, "❌ محدودیت روزانه ربات به پایان رسیده. فردا دوباره امتحان کنید.");
      return;
    }

    // Per-user limit check
    let withinLimit = true;
    try {
      withinLimit = await checkUserLimit(userId, chatId);
    } catch (error) {
      console.warn("⚠️ user limit check failed, allowing message:", error.message || error);
    }
    if (!withinLimit) {
      await safeSend(msg, pickRandom(LIMIT_MESSAGES));
      return;
    }

    // Tone detection
    let behavior = { tone: "neutral", intensity: 0 };
    let receivedFileName = "";
    if (msg.text) {
      behavior = detectTone(msg.text);
    } else if (msg.sticker) {
      behavior = { tone: "sticker", intensity: 0.5 };
    } else if (msg.file) {
      receivedFileName = msg.file.name || msg.file.mimeType || "file";
      behavior = { tone: detectFileTone(msg.file.mimeType || "", msg.file.name || ""), intensity: 0.5 };
    } else if (msg.media) {
      receivedFileName = msg.media.className || "file";
      behavior = { tone: detectFileTone(msg.media.className || "", ""), intensity: 0.5 };
    }

    const behaviorTone = behavior.tone;
    const behaviorIntensity = behavior.intensity;

    // Persist tone and behavior data
    let updatedUser = userInfo;
    let dailyMessages = [];
    let conversationPairs = [];
    let adaptation = {};
    try {
      await setUserTone(userId, chatId, behaviorTone);
      await updateUserBehavior(userId, chatId, behaviorTone);

      if (receivedFileName) await addReceivedFile(userId, chatId, receivedFileName);

      if (msg.text) {
        await saveDailyMessageMemory(userId, chatId, msg.text);
        await saveRecentMessage(userId, chatId, msg.text);
        await extractUserInterests(userId, chatId, msg.text);
      }

      await updateBehaviorProfile(userId, chatId, behaviorTone, behaviorIntensity);

      try {
        adaptation = await adaptPersonalityToBehavior(userId, chatId, behaviorTone, updatedUser.behaviorProfile || {});
      } catch (e) {
        console.warn("⚠️ adaptPersonalityToBehavior failed:", e.message);
      }

      updatedUser = (await getUserFullInfo(client, userId, chatId)) || userInfo;
      conversationPairs = await getConversationPairs(userId, chatId);
      dailyMessages = await getDailyMessages(userId, chatId);
    } catch (error) {
      console.warn(`⚠️ DB/API write failed (user ${userId}), continuing without persistence:`, error.message || error);
    }

    // Generate response
    let reply = "";
    const userMessageCount = userInfo.messageCount || 0;

    if (userMessageCount === 0) {
      reply = pickRandom(WELCOME_MESSAGES);
    } else {
      const context = {
        bio: updatedUser.bio,
        behavior: behaviorTone,
        tone: behaviorTone,
        intensity: behaviorIntensity,
        previousMessage: updatedUser.lastInteraction ? await getLastMessage(userId, chatId) : "",
        profilePhoto: updatedUser.photoAnalysis,
        behaviorCounts: updatedUser.behaviorCounts,
        profileChanged: updatedUser.profileChanged,
        bioChanged: updatedUser.bioChanged,
        previousPhotoAnalysis: updatedUser.previousPhotoAnalysis,
        previousBio: updatedUser.previousBio,
        behaviorProfile: updatedUser.behaviorProfile,
        personalityAdaptation: adaptation,
        userId,
        chatId,
        dailyMessages,
        conversationPairs,
      };

      let aiResponse = null;
      if (msg.text) {
        aiResponse = await getAIResponse(msg.text, context);
      } else if (msg.media) {
        const fileName = msg.file?.name || msg.media.className || "یک فایل";
        aiResponse = `این فایل رو دریافت کردم. به نظر می‌رسه که ${fileName} هست. در موردش توضیح بده.`;
      } else if (msg.sticker) {
        aiResponse = "ایول عجیب خفنه 👻";
      }

      if (aiResponse) {
        reply = aiResponse;
      } else {
        reply = await getDictionaryResponse(behavior, { isLimit: false });

        if (behaviorTone === "music" && msg.text) {
          await sendMusicFromChannel(chatId);
          await incrementUserMessage(userId, chatId);
          await updateSystemStatus({ totalDailyMessages: totalDailyMessages + 1 });
          totalDailyMessages += 1;
          return;
        }
      }
    }

    // Save conversation pair
    if (reply && reply.trim() && msg.text) {
      try {
        await saveConversationPair(userId, chatId, msg.text, reply);
      } catch (err) {
        console.warn("⚠️ could not save conversation pair:", err.message);
      }
    }

    // Send response
    if (reply) {
      await safeSend(msg, reply);
      await incrementUserMessage(userId, chatId);
      await updateSystemStatus({ totalDailyMessages: totalDailyMessages + 1 });
      totalDailyMessages += 1;

      console.log(`✅ send message for user: ${userId} (${behaviorTone}, intensity: ${behaviorIntensity})`);
    }
  } catch (error) {
    console.error("❌ error to analyze message:", error);
  }
}, new NewMessage({}));

// ==================== Helper Functions ====================
// Get last user message from history
async function getLastMessage(userId, chatId) {
  try {
    const history = await client.api.messages.getHistory({ peer: chatId, limit: 2 });
    for (const msg of history.messages) {
      if (toNumber(msg.senderId) === userId && msg.text) return msg.text;
    }
    return "";
  } catch (error) {
    return "";
  }
}

console.log("🚀 is running userbot.....");
console.log("💡 if one message all Account sleeping");

// ==================== Periodic Tasks ====================
// Periodic Gemini recovery check
setInterval(async () => { await checkAndRecoverGemini(); }, 60 * 60 * 1000);

// Keep-alive ping
async function keepAlive() {
  try {
    await client.api.account.updateStatus({ offline: false });
    await updateSystemStatus({ lastPing: new Date() });
    console.log("💓 ping send");
  } catch (error) {
    console.error("❌ error ping:", error);
  }
}
setInterval(keepAlive, 5 * 60 * 1000);

// Nightly tasks at 2 AM
async function runNightlyTasks() {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (hour === 2 && minute < 5) {
    console.log("🌙 Running nightly personality and dictionary updates...");
    await runNightlyPersonalityUpdate();
    await generateDailyDictionaryEntries();
    await reloadDictionary();
    console.log("✨ Nightly updates complete.");
  }
}

setInterval(async () => { await runNightlyTasks(); }, 60 * 60 * 1000);

console.log("🤖 Userbot memory system initialized (daily memory, behavior profiles, Taha v2.0 engine, dictionary DB)");

// ==================== Graceful Shutdown ====================
// Graceful shutdown
process.on("unhandledRejection", (error) => { console.error("❌ unexpected error:", error); });

process.on("SIGINT", async () => {
  console.log("🛑 is OFF ...");
  await client.destroy();
  server.close(() => { console.log("✅ HTTP server closed"); });
  process.exit(0);
});