import 'dotenv/config';
import http from 'http';
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage } from "teleproto/events/index.js";
import { Api } from "teleproto/tl/index.js";
import { FloodWaitError } from "teleproto/errors/index.js";
import { getSystemStatus, updateSystemStatus } from "./utils/database.js";
import { getDictionaryResponse } from "./utils/dictionaryHandler.js";
import { getAIResponse, checkAndRecoverGemini } from "./utils/aiHandler.js";
import { detectTone, detectFileTone } from "./utils/toneDetector.js";
import {
    getUserFullInfo, checkUserLimit, incrementUserMessage, setUserTone,
    updateUserBehavior, addReceivedFile, saveDailyMessageMemory, getDailyMessages,
    updateBehaviorProfile, adaptPersonalityToBehavior, extractUserInterests,
    saveRecentMessage
} from "./utils/userManager.js";
import { initializePersonalityInDB, runNightlyPersonalityUpdate } from "./utils/personalityManager.js";
import { generateDailyDictionaryEntries, reloadDictionary } from "./utils/dictionaryHandler.js";

// ==================== متغیرهای محیطی ====================

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionString = process.env.SESSION_STRING;
const ownerId = Number(process.env.OWNER_ID);
const dailyMessageLimit = Number(process.env.DAILY_MESSAGE_LIMIT) || 150;
const globalCooldownMinutes = Number(process.env.GLOBAL_COOLDOWN_MINUTES) || 5;

if (!apiId || !apiHash || !sessionString) {
    console.error("TELEGRAM_API_ID, TELEGRAM_API_HASH, SESSION_STRING  is empty");
    process.exit(1);
}

// ==================== لیست پیام‌های متغیر ====================

// لیست پیام‌های خوش‌آمدگویی (اولین پیام)
const WELCOME_MESSAGES = [
    "درود بر شما 👋🏻 عهه طاها نیست من دستیارشم اگه کمکی ازم برمیاد هستم خدمتتون",
    " سلام  خوبی طاها که نیس ... خدامیدونه کجا مشغوله کاری داری",
    "درود! من دستیار طاهام، اگه کاری از دستم برمیاد، بگو عزیزم.",
    "سلام عزیزم! طاها نیست، ولی من اینجام تا کمکت کنم.",
    "اربابم نیست و من اینجام تا بهتون کمک کنم",
    " درود بر تو مگه صبر کنی تا طاها بیاد من دسیارشم"
];

// لیست پیام‌های محدودیت (وقتی کاربر به سقف پیام می‌رسد)
const LIMIT_MESSAGES = [
    "خوب من باید برم تا توکن‌هامو تموم نکردی! صبر کن تا خودش بیاد... ⏳",
    "اوه، ظرفیت پیام‌های امروز پر شد. یه کم صبر کن تا چند ساعت دیگه! 😅",
    "من باید برم به کارم برسم یه عالمه کار دارمصب کن خودش بیاد دیگه بای بای 🙄",
    " خوب دیگه من کم کم برم دو ساعت دیگه برمیگردم هر دو ساعت فقط موظف به ارسال 5 پیام هستم",
    "اگه انقدر کارت مهمه که 6 تا پیام دادی صبر کن طا اربابم گهر وجودم دباره بیاد"
];

// انتخاب تصادفی یک گزینه از یک لیست
function pickRandom(list) {
    if (!list || list.length === 0) return '';
    return list[Math.floor(Math.random() * list.length)];
}

// ==================== توابع کمکی ====================

function toNumber(value) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    if (typeof value.toJSNumber === 'function') return value.toJSNumber();
    if (typeof value.valueOf === 'function') {
        const n = Number(value.valueOf());
        return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
}

// ==================== بررسی ربات بودن کاربر  ====================

const botUserCache = new Map();
const BOT_CACHE_TTL = 10 * 60 * 1000; 

async function isBotUser(userId) {
    if (botUserCache.has(userId)) {
        const entry = botUserCache.get(userId);
        if (Date.now() - entry.time < BOT_CACHE_TTL) return entry.isBot;
        botUserCache.delete(userId);
    }
    try {
        const full = await client.api.users.getFullUser({ id: userId });
        const user = Array.isArray(full?.users)
            ? full.users.find((u) => u && toNumber(u.id) === toNumber(userId))
            : null;
        const isBot = !!(user && user.bot);
        botUserCache.set(userId, { isBot, time: Date.now() });
        return isBot;
    } catch (error) {
        console.warn("⚠️ bot check failed, treating as non-bot:", error.message || error);
        return false;
    }
}

// ==================== راه‌اندازی HTTP Server برای رندر ====================

const server = http.createServer((req, res) => {
    if (req.url === '/healthcheck') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🤖 Userbot is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT} for health checks`);
});

// ==================== راه‌اندازی کلاینت تلگرام ====================

const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    {
        connectionRetries: 5,
        shouldReconnect: true,
    }
);

await client.start();

console.log("✅ Userbot is running successfully");
const me = await client.getMe();
console.log(`👤 User : ${me.firstName} (${me.id})`);

// ==================== مقداردهی اولیه شخصیت و دیکشنری در DB ====================
await initializePersonalityInDB();
await reloadDictionary();

// ==================== توابع کمکی بی‌اثری ====================

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
    console.log(`⏳ sleep all account until ${cooldownUntil.toLocaleString('fa-IR')} is ON`);
}

// ارسال پیام با مدیریت FloodWait تا نرخ‌محدودیت تلگرام باعث نادیده‌گرفتن پیام‌ها نشود
async function safeSend(msg, text) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await msg.reply({ message: text });
            return true;
        } catch (error) {
            if (error instanceof FloodWaitError) {
                const wait = Math.min(error.seconds || 5, 60);
                console.warn(`⚠️ flood wait ${wait}s، retrying in ${wait}s...`);
                await new Promise(r => setTimeout(r, (wait + 1) * 1000));
                continue;
            }
            console.error("❌ error to send message:", error);
            return false;
        }
    }
    return false;
}

// ==================== تابع ارسال آهنگ از کانال ====================
async function sendMusicFromChannel(chatId) {
    try {
        const channelId = process.env.MUSIC_CHANNEL_ID;
        if (!channelId) return false;

        const result = await client.api.messages.search({
            peer: channelId,
            q: '',
            filter: new Api.InputMessagesFilterMusic(),
            limit: 50
        });

        const musicMessages = result.messages || [];
        if (musicMessages.length === 0) return false;

        const musicMsg = musicMessages[Math.floor(Math.random() * musicMessages.length)];
        await client.forwardMessages(chatId, {
            messages: [musicMsg.id],
            fromPeer: channelId
        });
        return true;
    } catch (error) {
        console.error("❌ error send music:", error);
        return false;
    }
}

// ==================== هندلر اصلی پیام‌ها ====================
client.addEventHandler(
    async (event) => {
        try {
            const msg = event.message;
            if (!msg) return;

            const chatId = toNumber(msg.chatId ?? msg.chat?.id ?? msg.peerId);
            const userId = toNumber(msg.senderId ?? msg.fromId);

            if (chatId === undefined || userId === undefined) {
                console.warn("⚠️ chatId or senderId  is not find");
                return;
            }

            // اگر فرستنده پیام یک ربات باشد، پیام را کاملاً نادیده بگیر
            if (await isBotUser(userId)) {
                return;
            }

            if (!msg.text && !msg.media && !msg.sticker) return;

            // اگر خودمان پیام دادیم
            if (userId === ownerId) {
                await activateGlobalCooldown();
                console.log(`🔔 owner is typing, sleeping all account for ${globalCooldownMinutes} minutes is ON`);
                return;
            }

            // اگر در گروه هستیم و تگ نشده‌ایم
            if (msg.isPrivate !== true) {
                const username = me?.username;
                const text = msg.text || '';
                let isMentioned = false;
                if (username && msg.entities) {
                    for (const entity of msg.entities) {
                        if (entity instanceof Api.MessageEntityMention ||
                            entity instanceof Api.MessageEntityMentionName) {
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

            // بررسی بی‌اثری کل اکانت
            if (await isGlobalCooldownActive()) {
                console.log(`⏳ sleeping all account is ON, user ${userId} Ignored`);
                return;
            }

            // دریافت اطلاعات کامل کاربر
            let userInfo = await getUserFullInfo(client, userId, chatId);
            if (!userInfo) {
                console.warn(`⚠️ could not load user ${userId} data, replying with fallback`);
                userInfo = {
                    messageCount: 0,
                    bio: '',
                    photoAnalysis: '',
                    previousPhotoAnalysis: '',
                    previousBio: '',
                    behaviorCounts: {},
                    behaviorProfile: {},
                    personalityAdaptation: {},
                    profileChanged: false,
                    bioChanged: false,
                    lastInteraction: null,
                };
            }

            // بررسی محدودیت روزانه سیستم
            let status = null;
            let totalDailyMessages = 0;
            try {
                status = await getSystemStatus();
                const now = new Date();
                if (now >= status.dailyResetTime) {
                    await updateSystemStatus({
                        totalDailyMessages: 0,
                        dailyResetTime: new Date(now.setDate(now.getDate() + 1)),
                        dictionaryMode: false,
                        geminiQuotaExceeded: false
                    });
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

            // بررسی محدودیت هر کاربر
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

            // ===== تشخیص لحن کاربر  =====
            let behavior = { tone: 'neutral', intensity: 0 };
            let receivedFileName = '';
            if (msg.text) {
                behavior = detectTone(msg.text);
            } else if (msg.sticker) {
                behavior = { tone: 'sticker', intensity: 0.5 };
            } else if (msg.file) {
                receivedFileName = msg.file.name || msg.file.mimeType || 'file';
                behavior = { tone: detectFileTone(msg.file.mimeType || '', msg.file.name || ''), intensity: 0.5 };
            } else if (msg.media) {
                receivedFileName = msg.media.className || 'file';
                behavior = { tone: detectFileTone(msg.media.className || '', ''), intensity: 0.5 };
            }

            const behaviorTone = behavior.tone;
            const behaviorIntensity = behavior.intensity;

            // ===== ذخیره لحن و الگوی رفتاری در دیتابیس =====
            let updatedUser = userInfo;
            let adaptation = {};
            let dailyMessages = [];
            try {
                await setUserTone(userId, chatId, behaviorTone);
                await updateUserBehavior(userId, chatId, behaviorTone);

                if (receivedFileName) {
                    await addReceivedFile(userId, chatId, receivedFileName);
                }

                // ===== حافظه روزانه: ذخیره آخرین ۲ پیام امروز =====
                if (msg.text) {
                    await saveDailyMessageMemory(userId, chatId, msg.text);
                    await saveRecentMessage(userId, chatId, msg.text);

                    // استخراج علایق/کلمات کلیدی
                    await extractUserInterests(userId, chatId, msg.text);
                }

                // ===== به‌روزرسانی پروفایل رفتاری میانگین =====
                await updateBehaviorProfile(userId, chatId, behaviorTone, behaviorIntensity);

                // ===== دریافت پروفایل بروز شده و سازگاری شخصیت =====
                updatedUser = await getUserFullInfo(client, userId, chatId) || userInfo;
                adaptation = await adaptPersonalityToBehavior(
                    userId, chatId, behaviorTone,
                    updatedUser.behaviorProfile || {}
                );

                
                dailyMessages = await getDailyMessages(userId, chatId);
            } catch (error) {
                console.warn(`⚠️ DB/API write failed (user ${userId}), continuing without persistence:`, error.message || error);
            }

            // ====== اولین پیام ======
            let reply = '';
            const userMessageCount = userInfo.messageCount || 0;

            if (userMessageCount === 0) {
                reply = pickRandom(WELCOME_MESSAGES);
            } else {
                // ===== ساخت context کامل برای AI =====
                const context = {
                    bio: updatedUser.bio,
                    behavior: behaviorTone,
                    tone: behaviorTone,
                    intensity: behaviorIntensity,
                    previousMessage: updatedUser.lastInteraction ? await getLastMessage(userId, chatId) : '',
                    profilePhoto: updatedUser.photoAnalysis,
                    behaviorCounts: updatedUser.behaviorCounts,
                    profileChanged: updatedUser.profileChanged,
                    bioChanged: updatedUser.bioChanged,
                    previousPhotoAnalysis: updatedUser.previousPhotoAnalysis,
                    previousBio: updatedUser.previousBio,
                    behaviorProfile: updatedUser.behaviorProfile,
                    personalityAdaptation: adaptation,
                    userId: userId,
                    chatId: chatId,
                    dailyMessages: dailyMessages
                };

                let aiResponse = null;
                if (msg.text) {
                    aiResponse = await getAIResponse(msg.text, context);
                } else if (msg.media) {
                    const fileName = msg.file?.name || msg.media.className || 'یک فایل';
                    aiResponse = `این فایل رو دریافت کردم. به نظر می‌رسه که ${fileName} هست. در موردش توضیح بده.`;
                } else if (msg.sticker) {
                    aiResponse = "ایول عجیب خفنه 👻";
                }

                if (aiResponse) {
                    reply = aiResponse;
                } else {
                    // اگر Gemini جواب نداد، از دیکشنری DB استفاده کن
                    reply = await getDictionaryResponse(behavior, { isLimit: false });

                   
                    if (behaviorTone === 'music' && msg.text) {
                        await sendMusicFromChannel(chatId);
                        await incrementUserMessage(userId, chatId);
                        await updateSystemStatus({
                            totalDailyMessages: totalDailyMessages + 1
                        });
                        totalDailyMessages += 1;
                        return;
                    }
                }
            }

            // ====== ارسال پاسخ ======
            if (reply) {
                await safeSend(msg, reply);

                await incrementUserMessage(userId, chatId);
                await updateSystemStatus({
                    totalDailyMessages: totalDailyMessages + 1
                });
                totalDailyMessages += 1;

                console.log(`✅ send message for user: ${userId} (${behaviorTone}, intensity: ${behaviorIntensity})`);
            }

        } catch (error) {
            console.error("❌ error to analyze message:", error);
        }
    },
    new NewMessage({})
);

// ==================== تابع دریافت آخرین پیام کاربر ====================
async function getLastMessage(userId, chatId) {
    try {
        const history = await client.api.messages.getHistory({
            peer: chatId,
            limit: 2
        });
        for (const msg of history.messages) {
            if (toNumber(msg.senderId) === userId && msg.text) {
                return msg.text;
            }
        }
        return '';
    } catch (error) {
        return '';
    }
}

console.log("🚀 is running userbot.....");
console.log("💡 if one message all Account sleeping");

// ==================== بررسی دوره‌ای Gemini برای ریکاوری ====================
setInterval(async () => {
    await checkAndRecoverGemini();
}, 60 * 60 * 1000);

// ==================== پینگ برای جلوگیری از خواب ====================
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

// ==================== برنامه‌ریزی شبانه: بروزرسانی شخصیت و دیکشنری هر شب ساعت ۲ ====
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

// بررسی شبانه هر ساعت
setInterval(async () => {
    await runNightlyTasks();
}, 60 * 60 * 1000); 


setInterval(async () => {
    console.log("🌙 Running scheduled daily personality + dictionary updates...");
    await runNightlyPersonalityUpdate();
    await generateDailyDictionaryEntries();
    await reloadDictionary();
    console.log("✨ Daily update cycle complete.");
}, 24 * 60 * 60 * 1000); 

console.log("🤖 Userbot memory system initialized (daily memory, behavior profiles, personality DB, dictionary DB)");

// ==================== مدیریت خاموش شدن ====================
process.on("unhandledRejection", (error) => {
    console.error("❌ unexpected error:", error);
});

process.on("SIGINT", async () => {
    console.log("🛑 is OFF ...");
    await client.destroy();
    server.close(() => {
        console.log("✅ HTTP server closed");
    });
    process.exit(0);
});
