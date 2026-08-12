// ======================================================================
// index.js - فایل اصلی ربات
// ======================================================================

// ---- import ها ----
import 'dotenv/config';
import http from 'http';
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage } from "teleproto/events/index.js";
import { Api } from "teleproto/tl/index.js";
import { FloodWaitError } from "teleproto/errors/index.js";
import { getSystemStatus, updateSystemStatus, incrementDailyMessages } from "./utils/database.js";
import { getDictionaryResponse } from "./utils/dictionaryHandler.js";
import { getAIResponse, checkAndRecoverGemini } from "./utils/aiHandler.js";
import { detectTone, detectFileTone } from "./utils/toneDetector.js";
import {
    getUserFullInfo, checkUserLimit, incrementUserMessage, setUserTone,
    updateUserBehavior, addReceivedFile, saveDailyMessageMemory, getDailyMessages,
    updateBehaviorProfile, adaptPersonalityToBehavior, extractUserInterests,
    saveRecentMessage, analyzeAndStoreProfile
} from "./utils/userManager.js";
import { initializePersonalityInDB, runNightlyPersonalityUpdate } from "./utils/personalityManager.js";
import { generateDailyDictionaryEntries, reloadDictionary } from "./utils/dictionaryHandler.js";
import { setupProxy } from "./utils/proxySetup.js";

// ---- خواندن تنظیمات از .env ----
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

// ---- پیام‌های خوش‌آمدگویی ----
const WELCOME_MESSAGES = [
    "درود بر شما 👋🏻 عهه طاها نیست من دستیارشم اگه کمکی ازم برمیاد هستم خدمتتون",
    " سلام  خوبی طاها که نیس ... خدامیدونه کجا مشغوله کاری داری",
    "درود! من دستیار طاهام، اگه کاری از دستم برمیاد، بگو عزیزم.",
    "سلام عزیزم! طاها نیست، ولی من اینجام تا کمکت کنم.",
    "اربابم نیست و من اینجام تا بهتون کمک کنم",
    " درود بر تو مگه صبر کنی تا طاها بیاد من دسیارشم"
];

// ---- پیام‌های محدودیت ----
const LIMIT_MESSAGES = [
    "خوب من باید برم تا توکن‌هامو تموم نکردی! صبر کن تا خودش بیاد... ⏳",
    "اوه، ظرفیت پیام‌های امروز پر شد. یه کم صبر کن تا چند ساعت دیگه! 😅",
    "من باید برم به کارم برسم یه عالمه کار دارمصب کن خودش بیاد دیگه بای بای 🙄",
    " خوب دیگه من کم کم برم دو ساعت دیگه برمیگردم هر دو ساعت فقط موظف به ارسال 5 پیام هستم",
    "اگه انقدر کارت مهمه که 6 تا پیام دادی صبر کن طا اربابم گهر وجودم دباره بیاد"
];

// ---- انتخاب تصادفی از لیست ----
function pickRandom(list) {
    if (!list || list.length === 0) return '';
    return list[Math.floor(Math.random() * list.length)];
}

// ---- تشخیص درخواست تحلیل عکس پروفایل ----
const PROFILE_ANALYSIS_KEYWORDS = [
    /تحلیل.{0,15}(عکس|عکسم|پروفایل|پروفایلم)/i,
    /(عکس|عکسم|پروفایل|پروفایلم).{0,15}تحلیل/i,
    /پروفایلم.{0,10}(چطور|چطوره|جوریه|نظر|ببین)/i,
    /عکسم.{0,10}(چطور|چطوره|جوریه|نظر|ببین|قشن)/i,
    /(نگاه|ببین).{0,10}عکس.{0,5}من/i,
    /analyze.{0,15}(my\s+)?(photo|profile)/i,
    /profile\s*(photo|pic)?\s*(analy)?(ze)?/i
];
function isProfileAnalysisRequest(text) {
    if (!text) return false;
    return PROFILE_ANALYSIS_KEYWORDS.some((r) => r.test(text));
}

// ---- تشخیص درخواست صریح آهنگ/موزیک ----
const MUSIC_REQUEST_KEYWORDS = [
    /(اهنگ|آهنگ|موزیک|موسیقی|ترانه).{0,20}(بده|بفرست|بفرستی|پخش|پخش کن|بذار|بزار|بزن|میخوام|می‌خوام|پیشنهاد|فوروارد)/i,
    /(بده|بفرست|پخش کن|بذار|بزار|بزن|میخوام|می‌خوام).{0,20}(اهنگ|آهنگ|موزیک|موسیقی|ترانه)/i,
    /(اهنگ|آهنگ|موزیک).{0,10}(داری|دارید|داریم)(\?|؟)?\s*$/i,
    /(?:یه|یک|يک)\s*(?:اهنگ|آهنگ|موزیک)\s*$/i
];
function isMusicRequest(text) {
    if (!text) return false;
    return MUSIC_REQUEST_KEYWORDS.some((r) => r.test(text));
}

// ---- تبدیل مقادیر مختلف به عدد ----
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

// ---- بررسی ربات بودن فرستنده (با کش) ----
const botUserCache = new Map();
const BOT_CACHE_TTL = 10 * 60 * 1000;

async function isBotUser(msg) {
    const userId = toNumber(msg.senderId ?? msg.fromId);

    if (userId === undefined || userId < 0) return false;

    const sender = msg.sender;
    if (sender && typeof sender.bot === 'boolean') {
        return sender.bot;
    }

    if (botUserCache.has(userId)) {
        const entry = botUserCache.get(userId);
        if (Date.now() - entry.time < BOT_CACHE_TTL) return entry.isBot;
        botUserCache.delete(userId);
    }
    try {
    
        const input = await client.getInputEntity(userId);
        if (input instanceof Api.InputPeerChannel || input instanceof Api.InputPeerChat) {
            return false;
        }
        const full = await client.api.users.getFullUser({ id: input });
        const user = Array.isArray(full?.users)
            ? full.users.find((u) => u && toNumber(u.id) === toNumber(userId))
            : null;
        const isBot = !!(user && user.bot);
        botUserCache.set(userId, { isBot, time: Date.now() });
        return isBot;
    } catch (error) {
        console.warn("--------------- bot check failed, treating as non-bot:", error.message || error);
        return false;
    }
}

// ---- سرور HTTP برای Health Check ----
const server = http.createServer((req, res) => {
    if (req.url === '/healthcheck') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('************************************ Userbot is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`******************************** HTTP server running on port ${PORT} for health checks`);
});

// ---- اتصال به تلگرام ----
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

setupProxy();

console.log("************************************* Userbot is running successfully");
const me = await client.getMe();
console.log(`************************************* User : ${me.firstName} (${me.id})`);

// ---- راه‌اندازی اولیه شخصیت و دیکشنری ----
await initializePersonalityInDB();
await reloadDictionary();

// ---- کول‌داون (خواب) کل حساب ----
async function isGlobalCooldownActive() {
    try {
        const status = await getSystemStatus();
        if (!status.globalCooldownUntil) return false;
        return new Date() < status.globalCooldownUntil;
    } catch (error) {
        console.warn("---------- cooldown check failed, treating as inactive:", error.message || error);
        return false;
    }
}

async function activateGlobalCooldown() {
    const cooldownUntil = new Date(Date.now() + globalCooldownMinutes * 60 * 1000);
    await updateSystemStatus({ globalCooldownUntil: cooldownUntil });
    console.log(`************* sleep all account until ${cooldownUntil.toLocaleString('fa-IR')} is ON`);
}

// ---- ارسال امن پیام (مدیریت FloodWait) ----
async function safeSend(msg, text) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await msg.reply({ message: text });
            return true;
        } catch (error) {
            if (error instanceof FloodWaitError) {
                const wait = Math.min(error.seconds || 5, 60);
                console.warn(`--------------- flood wait ${wait}s، retrying in ${wait}s...`);
                await new Promise(r => setTimeout(r, (wait + 1) * 1000));
                continue;
            }
            console.error("-------------- error to send message:", error);
            return false;
        }
    }
    return false;
}

// ---- فوروارد موزیک تصادفی از کانال ----
async function sendMusicFromChannel(chatId) {
    try {
        const channelIdStr = process.env.MUSIC_CHANNEL_ID;
        if (!channelIdStr) return false;

        const channelId = BigInt(channelIdStr);

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
        console.error("--------------- error send music:", error);
        return false;
    }
}

// ---- هندلر اصلی پیام‌ها ----
client.addEventHandler(
    async (event) => {
        try {
            const msg = event.message;
            if (!msg) return;

            const chatId = toNumber(msg.chatId ?? msg.chat?.id ?? msg.peerId);
            const userId = toNumber(msg.senderId ?? msg.fromId);

            if (chatId === undefined || userId === undefined) {
                console.warn("---------------- chatId or senderId  is not find");
                return;
            }

            // ایگنور کردن ربات‌ها
            if (await isBotUser(msg)) {
                return;
            }

            if (!msg.text && !msg.media && !msg.sticker) return;

            // اگر صاحب ربات پیام داد => خواب کل حساب
            if (userId === ownerId) {
                await activateGlobalCooldown();
                console.log(`------------ owner is typing, sleeping all account for ${globalCooldownMinutes} minutes is ON`);
                return;
            }

            // در گروه فقط وقتی تگ شده باشیم جواب بده
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

            // خواب بودن کل حساب
            if (await isGlobalCooldownActive()) {
                console.log(`⏳ sleeping all account is ON, user ${userId} Ignored`);
                return;
            }

            // بارگذاری اطلاعات کامل کاربر
            let userInfo = await getUserFullInfo(client, userId, chatId);
            if (!userInfo) {
                console.warn(`---------- could not load user ${userId} data, replying with fallback`);
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

            // چک سقف روزانه کل ربات
            let status = null;
            let totalDailyMessages = 0;
            try {
                status = await getSystemStatus();
                const now = new Date();
                if (now >= status.dailyResetTime) {
                    const nextMidnight = new Date();
                    nextMidnight.setHours(24, 0, 0, 0);
                    await updateSystemStatus({
                        totalDailyMessages: 0,
                        dailyResetTime: nextMidnight,
                        dictionaryMode: false,
                        geminiQuotaExceeded: false
                    });
                    status = await getSystemStatus();
                }
                totalDailyMessages = status.totalDailyMessages || 0;
            } catch (error) {
                console.warn("------- system status check failed, ignoring daily limit:", error.message || error);
            }

            if (totalDailyMessages >= dailyMessageLimit) {
                await safeSend(msg, "------------- محدودیت روزانه ربات به پایان رسیده. فردا دوباره امتحان کنید.");
                return;
            }

            // چک سقف پیام هر کاربر
            let withinLimit = true;
            try {
                withinLimit = await checkUserLimit(userId, chatId);
            } catch (error) {
                console.warn("--------- user limit check failed, allowing message:", error.message || error);
            }
            if (!withinLimit) {
                await safeSend(msg, pickRandom(LIMIT_MESSAGES));
                return;
            }

            // تشخیص لحن پیام
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

            // ذخیره لحن و رفتار در دیتابیس
            let updatedUser = userInfo;
            let adaptation = {};
            let dailyMessages = [];
            try {
                await setUserTone(userId, chatId, behaviorTone);
                await updateUserBehavior(userId, chatId, behaviorTone);

                if (receivedFileName) {
                    await addReceivedFile(userId, chatId, receivedFileName);
                }

// حافظه روزانه: ۲ پیام آخر امروز
                if (msg.text) {
                    await saveDailyMessageMemory(userId, chatId, msg.text);
                    await saveRecentMessage(userId, chatId, msg.text);

                    // استخراج علایق
                    await extractUserInterests(userId, chatId, msg.text);
                }

// به‌روزرسانی پروفایل رفتاری
                await updateBehaviorProfile(userId, chatId, behaviorTone, behaviorIntensity);

// تطبیق شخصیت ربات با رفتار کاربر
                updatedUser = await getUserFullInfo(client, userId, chatId) || userInfo;
                adaptation = await adaptPersonalityToBehavior(
                    userId, chatId, behaviorTone,
                    updatedUser.behaviorProfile || {}
                );

                
                dailyMessages = await getDailyMessages(userId, chatId);
            } catch (error) {
                console.warn(`------- DB/API write failed (user ${userId}), continuing without persistence:`, error.message || error);
            }

// تصمیم‌گیری جواب
            let reply = '';

// تحلیل عکس پروفایل فقط با درخواست صریح
            if (msg.text && isProfileAnalysisRequest(msg.text)) {
                const prevAnalysis = userInfo.previousPhotoAnalysis || userInfo.photoAnalysis || '';
                const analysis = await analyzeAndStoreProfile(client, userId, chatId, prevAnalysis);
                if (analysis) {
                    await safeSend(msg, ` این هم تحلیل عکس پروفایلت:\n\n${analysis}`);
                    await incrementUserMessage(userId, chatId);
                    await incrementDailyMessages();
                    console.log(`****** profile photo analyzed for user: ${userId} (on request)`);
                    return;
                }
                reply = "نتونستم عکس پروفایلت رو پیدا/تحلیل کنم  (شاید سهمیه‌ی AI تموم شده یا عکسی نداری)";
            }

            const userMessageCount = userInfo.messageCount || 0;

            if (reply) {
                // جواب آماده است
            } else if (userMessageCount === 0) {
                reply = pickRandom(WELCOME_MESSAGES);
            } else if (behaviorTone === 'music' && msg.text && isMusicRequest(msg.text)) {
                // درخواست صریح موزیک: فوروارد مستقیم از کانال
                const forwarded = await sendMusicFromChannel(chatId);
                if (forwarded) {
                    await incrementUserMessage(userId, chatId);
                    await incrementDailyMessages();
                    return;
                }
                reply = "الان توی کانال آهنگی برای فوروارد نبود 🎧";
            } else {
                // ساخت کانتکست کامل برای AI
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
                    aiResponse = ` این فایله چیه فرستادی من که نمیتونم تحلیلش کنم دهنم سرویس میشه و توکنام ته میکشه${fileName} چیه ؟`;
                } else if (msg.sticker) {
                    aiResponse = "ایول عجیب خفنه 👻";
                }

                if (aiResponse) {
                    reply = aiResponse;
                } else {
                    // فالبک به دیکشنری وقتی Gemini جواب نده
                    reply = await getDictionaryResponse(behavior, { isLimit: false });
                }
            }

            // ارسال جواب
            if (reply) {
                await safeSend(msg, reply);

                await incrementUserMessage(userId, chatId);
                await incrementDailyMessages();

                console.log(`***** send message for user: ${userId} (${behaviorTone}, intensity: ${behaviorIntensity})`);
            }

        } catch (error) {
            console.error("***** error to analyze message:", error);
        }
    },
    new NewMessage({})
);

// ---- گرفتن آخرین پیام کاربر برای کانتکست ----
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

console.log("***** is running userbot.....");
console.log("***** if one message all Account sleeping");

// ---- چک دوره‌ای برگشت سهمیه Gemini ----
setInterval(async () => {
    await checkAndRecoverGemini();
}, 60 * 60 * 1000);

// ---- Ping برای زنده نگه داشتن اکانت ----
async function keepAlive() {
    try {
        await client.api.account.updateStatus({ offline: false });
        await updateSystemStatus({ lastPing: new Date() });
        console.log("***** ping send");
    } catch (error) {
        console.error("----- error ping:", error);
    }
}
setInterval(keepAlive, 5 * 60 * 1000);

// ---- وظایف شبانه (ساعت ۲ بامداد) ----
async function runNightlyTasks() {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();

    
    if (hour === 2 && minute < 5) {
        console.log("***** Running nightly personality and dictionary updates...");
        await runNightlyPersonalityUpdate();
        await generateDailyDictionaryEntries();
        await reloadDictionary();
        console.log("***** Nightly updates complete.");
    }
}

// چک هر ساعت یک بار
setInterval(async () => {
    await runNightlyTasks();
}, 60 * 60 * 1000);

console.log("***** Userbot memory system initialized (daily memory, behavior profiles, personality DB, dictionary DB)");

// ---- مدیریت خطا و خاموش‌شدن ----
process.on("unhandledRejection", (error) => {
    console.error("----- unexpected error:", error);
});

process.on("SIGINT", async () => {
    console.log("***** is OFF ...");
    await client.destroy();
    server.close(() => {
        console.log("***** HTTP server closed");
    });
    process.exit(0);
});
