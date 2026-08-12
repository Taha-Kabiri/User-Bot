import mongoose from "mongoose";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PERSONALITY } from '../personality.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mongoURI = process.env.MONGO_URI;
if (!mongoURI) {
  console.error(" MONGO_URI empty !!!!!!!!!!!!!!!!!!!!");
  process.exit(1);
}

await mongoose.connect(mongoURI);
console.log("connecting to MongoDB Atlas");

// ===== مدل شخصیت  =====
const personalitySchema = new mongoose.Schema({
  type: { type: String, enum: ["global", "user"], default: "global" },
  userId: { type: Number, default: null },
  chatId: { type: Number, default: null },
  // بخش‌های شخصیت به‌روزرسانی‌شده شبیه personality.txt
  sections: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // شارگرهای بومی برای هر بخش (مثلاً افزودن کلمات یا مثال‌های جدید)
  sectionNotes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  lastUpdated: { type: Date, default: Date.now },
  version: { type: Number, default: 1 },
});

// ===== مدل دیکشنری  =====
const dictionarySchema = new mongoose.Schema({
  // هر دسته‌شده بر پایه tone
  categories: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // ردیف‌های جدید اضافه‌شده توسط کارگر شبانه
  dailyAdditions: {
    type: [{
      category: String,
      responses: [String],
      sourceDate: { type: Date, default: Date.now },
      sourceUser: { type: Number, default: null }
    }],
    default: []
  },
  lastUpdated: { type: Date, default: Date.now }
});

// ===== مدل کاربر (گسترش یافته برای حافظه بلندمدت و پروفایل رفتاری) =====
const userSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  chatId: { type: Number, required: true },
  isActive: { type: Boolean, default: true },
  messageCount: { type: Number, default: 0 },
  resetTime: { type: Date, default: null },
  lastInteraction: { type: Date, default: Date.now },
  bio: { type: String, default: "" },
  bioHash: { type: String, default: "" },
  profilePhoto: { type: String, default: "" },
  photoId: { type: String, default: "" },
  personality: { type: String, default: "unknown" },
  tone: { type: String, default: "neutral" },
  behaviorCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
  receivedFiles: { type: [String], default: [] },
  analysisHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },

  // ===== حافظه روزانه: آخرین ۲ پیام هر روز =====
  dailyMessageMemory: {
    type: [{
      date: { type: String, required: true },
      messages: { type: [String], default: [] }
    }],
    default: []
  },
  last24hMessages: { type: [String], default: [] },

  // ===== پروفایل رفتاری ترکیبی و میانگین کاربر =====
  behaviorProfile: {
    type: {
      // شمارش دقیق تمام لحن‌ها
      toneCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
      // میانگین وزن‌دار رفتارهای کاربر (0-1)
      toneDistribution: { type: mongoose.Schema.Types.Mixed, default: {} },
      // آخرین ۳۰ روز لحن‌ها
      recentTones: {
        type: [{
          date: String,
          tone: String,
          intensity: Number
        }],
        default: []
      },
      // سطوح شخصیتی - چقدر این کاربر بی‌ادب، مودب، عاشقانه، سکسی، ورزشی و ... است
      levels: {
        rude: { type: Number, default: 0 },
        polite: { type: Number, default: 0 },
        romantic: { type: Number, default: 0 },
        sexy: { type: Number, default: 0 },
        sports: { type: Number, default: 0 },
        dirtyTalk: { type: Number, default: 0 },
        music: { type: Number, default: 0 }
      },
      // سابقه آینده: مواردی که فعال‌گر شده است
      flags: {
        excessiveRude: { type: Boolean, default: false },
        excessivePolite: { type: Boolean, default: false },
        excessiveRomantic: { type: Boolean, default: false },
        excessiveSexy: { type: Boolean, default: false }
      },
      // علاقه‌مندی‌های کاربر (کلمات/موضوعات کلیدی)
      interests: { type: [String], default: [] },
      // آخرین بروزرسانی شناسایی سطوح
      lastProfileUpdate: { type: Date, default: Date.now }
    },
    default: {}
  },

  // ===== سازگاری شخصیت بات نسبت به این کاربر (Adaptive Personality) =====
  personalityAdaptation: {
    type: {
      // چند برابر بودن لحن بات برای بی‌ادبی نسبت به الگوی کاربر
      rudeMultiplier: { type: Number, default: 1.0 },
      // چند برابر عاشقانگی بات
      romanticBoost: { type: Number, default: 1.0 },
      // چند برابر سکسی بودن بات
      sexyBoost: { type: Number, default: 1.0 },
      // چند برابر مهربونی بات
      kindnessBoost: { type: Number, default: 1.0 },
      // سطح بهنشر بودن ورزشی بات برای این کاربر
      sportsInterest: { type: Number, default: 0.5 },
      // سطح بهنشر بودن واقعی بات در موسیقی
      musicInterest: { type: Number, default: 0.5 },
      // سطح dirty talk
      dirtyTalkLevel: { type: Number, default: 0.3 },
      // سطح مودب بودن
      politenessLevel: { type: Number, default: 0.5 },
      // بخش‌های سفارشی شخصیت برای این کاربر (اگر سفارشی شده باشد)
      customSections: { type: mongoose.Schema.Types.Mixed, default: {} },
      // آخرین بروزرسانی
      lastAdaptation: { type: Date, default: Date.now }
    },
    default: {}
  },
});

// ===== مدل وضعیت سیستم (به‌روزرسانی شده) =====
const systemStatusSchema = new mongoose.Schema({
  totalDailyMessages: { type: Number, default: 0 },
  dailyResetTime: {
    type: Date,
    default: () => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 1);
      return d;
    },
  },
  geminiQuotaExceeded: { type: Boolean, default: false },
  dictionaryMode: { type: Boolean, default: false },
  globalCooldownUntil: { type: Date, default: null },
  lastPing: { type: Date, default: Date.now },
  // زمان آخرین بروزرسانی شبانه شخصیت
  lastPersonalityUpdate: { type: Date, default: null },
  // زمان آخرین افزودن به دیکشنری
  lastDictionaryUpdate: { type: Date, default: null },
});

const User = mongoose.model("User", userSchema);
const SystemStatus = mongoose.model("SystemStatus", systemStatusSchema);
const Personality = mongoose.model("Personality", personalitySchema);
const Dictionary = mongoose.model("Dictionary", dictionarySchema);

// ===== توابع کمکی =====
export async function getSystemStatus() {
  let status = await SystemStatus.findOne();
  if (!status) {
    status = new SystemStatus();
    await status.save();
  }
  return status;
}

export async function updateSystemStatus(update) {
  return await SystemStatus.findOneAndUpdate({}, update, {
    returnDocument: "after",
    upsert: true,
  });
}

export async function getUser(userId, chatId) {
  let user = await User.findOne({ userId, chatId });
  if (!user) {
    user = new User({ userId, chatId });
    await user.save();
  }
  return user;
}

export async function updateUser(userId, chatId, update) {
  return await User.findOneAndUpdate({ userId, chatId }, update, {
    returnDocument: "after",
    upsert: true,
  });
}

// ===== توابع مدیریت شخصیت در DB =====
export async function getGlobalPersonality() {
  let p = await Personality.findOne({ type: "global" });
  if (!p) {
    const def = loadPersonalityFromFile();
    p = new Personality({ type: "global", sections: splitPersonalityIntoSections(def) });
    await p.save();
  }
  return p;
}

export async function getUserPersonality(userId, chatId) {
  let p = await Personality.findOne({ type: "user", userId, chatId });
  if (!p) {
    const globalP = await getGlobalPersonality();
    p = new Personality({ type: "user", userId, chatId, sections: { ...globalP.sections } });
    await p.save();
  }
  return p;
}

export async function updateGlobalPersonality(sections, notes) {
  return await Personality.findOneAndUpdate(
    { type: "global" },
    { sections, sectionNotes: notes || {}, lastUpdated: new Date(), $inc: { version: 1 } },
    { returnDocument: "after", upsert: true }
  );
}

export async function updateUserPersonality(userId, chatId, sections) {
  return await Personality.findOneAndUpdate(
    { type: "user", userId, chatId },
    { sections, lastUpdated: new Date(), $inc: { version: 1 } },
    { returnDocument: "after", upsert: true }
  );
}

// خواندن فایل personality.txt و تقسیم به بخش‌ها
export function loadPersonalityFromFile() {
  const personalityPath = path.join(__dirname, '..', 'personality.txt');
  try {
    if (fs.existsSync(personalityPath)) {
      return fs.readFileSync(personalityPath, 'utf-8');
    }
  } catch (err) {
    console.warn("⚠️ personality.txt not found, using default");
  }
  // fallback to personality.js default
  return DEFAULT_PERSONALITY;
}

// تقسیم متن شخصیت به بخش‌های منظم برای ویرایش شبانه
export function splitPersonalityIntoSections(text) {
  const sections = {};
  // استخراج بخش "شخصیت شما"
  const personalityMatch = text.match(/شخصیت شما:([\s\S]*?)(?=قوانین رفتاری|استفاده از|$)/i);
  sections.personality = personalityMatch ? personalityMatch[1].trim() : "";

  // استخراج قوانین رفتاری
  const rulesMatch = text.match(/قوانین رفتاری[\s\S]*?:([\s\S]*?)(?=استفاده از|$)/i);
  sections.rules = rulesMatch ? rulesMatch[1].trim() : "";

  // بخش‌های سفارشی: موسیقی، ورزش، بیوگرافی
  sections.music = extractSection(text, "موسیقی", "ورزش");
  sections.sports = extractSection(text, "ورزش", "گفت‌وگو");
  sections.bioUsage = extractSection(text, "بیوگرافی", "$");

  // اگر خالی بود، مقدار پیش‌فرض بده
  if (!sections.personality) sections.personality = text.trim();
  if (!sections.rules) sections.rules = "طبیعی، انسانی و غیررباتی صحبت کن؛ سوال بی‌ربط نپرس.";
  if (!sections.music) sections.music = "با کاربران علاقه‌مند به موسیقی: صحبت‌های مرتبط با آهنگ، خواننده، ترانه بزن.";
  if (!sections.sports) sections.sports = "با کاربران علاقه‌مند به ورزش: در مورد فوتبال/بازی/ورزش بحث کن.";
  if (!sections.bioUsage) sections.bioUsage = "همیشه از بیوگرافی و عکس کاربر در پاسخ استفاده کن.";

  return sections;
}

function extractSection(text, startKeyword, endKeyword) {
  const startRegex = new RegExp(startKeyword, 'i');
  const endRegex = endKeyword === "$" ? null : new RegExp(endKeyword, 'i');
  const startMatch = text.match(startRegex);
  if (!startMatch) return "";
  const startIndex = startMatch.index + startMatch[0].length;
  let endIndex = text.length;
  if (endRegex) {
    const endMatch = text.slice(startIndex).match(endRegex);
    if (endMatch) endIndex = startIndex + endMatch.index;
  }
  return text.slice(startIndex, endIndex).trim();
}

// ===== توابع مدیریت دیکشنری در DB =====
export async function getDictionaryDoc() {
  let doc = await Dictionary.findOne();
  if (!doc) {
    const defaultDict = loadDefaultDictionary();
    doc = new Dictionary({ categories: defaultDict });
    await doc.save();
  }
  return doc;
}

function loadDefaultDictionary() {
  const dictPath = path.join(__dirname, '..', 'dictionary.json');
  try {
    if (fs.existsSync(dictPath)) {
      return JSON.parse(fs.readFileSync(dictPath, 'utf-8'));
    }
  } catch (err) {
    console.warn("⚠️ dictionary.json not found, using built-in default");
  }
  return {
    default: ["درود طاها نیستم، من دستیارشم در خدمت شما! اگه کارت مهمه بگو عزیزم."],
    polite: ["چشم عزیزم، در خدمت شما هستم! 🙏"],
    rude: ["کصخل بابا! تو به من می‌گی چیکار کنم؟ 🖕"],
    romantic: ["چه چشمان قشنگی داری عزیزم! 😍"],
    music: ["آهنگ خوبی انتخاب کردی! 🎵"],
    sexy: ["می‌دونی این لباس چه می‌کنه بهت؟ 😏"],
    sports: ["چه بازیک اگه؟ فوتبال امروز رو می‌بینی؟ ⚽"],
    dirty_talk: ["می‌دونی صبح تا شب فکرت هستم... 💦"],
    limit: ["خوب من باید برم! صبر کن تا خودش بیاد... ⏳"]
  };
}

// افزودن واکنش جدید به دیکشنری برای دسته‌ی مشخص
export async function addDictionaryEntry(category, response, sourceUserId = null) {
  const doc = await getDictionaryDoc();
  if (!doc.categories[category]) doc.categories[category] = [];
  if (!doc.categories[category].some(r => r === response)) {
    doc.categories[category].push(response);
    doc.dailyAdditions.push({ category, responses: [response], sourceUser: sourceUserId });
  }
  doc.lastUpdated = new Date();
  await doc.save();
  return doc.categories;
}

// گرفتن تمام دیکشنری 
export async function getAllDictionaryCategories() {
  const doc = await getDictionaryDoc();
  return doc.categories;
}

// صادرات مدل‌ها
export { User, SystemStatus, Personality, Dictionary };
