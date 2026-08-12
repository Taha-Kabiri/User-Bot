// ======================================================================
// database.js - اتصال به MongoDB و تعریف مدل‌ها
// ======================================================================

// ---- import ها و اتصال ----
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

// ---- اسکیمای شخصیت ----
const personalitySchema = new mongoose.Schema({
  type: { type: String, enum: ["global", "user"], default: "global" },
  userId: { type: Number, default: null },
  chatId: { type: Number, default: null },
  // بخش‌های شخصیت (مثل personality.txt)
  sections: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // توضیحات هر بخش
  sectionNotes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  lastUpdated: { type: Date, default: Date.now },
  version: { type: Number, default: 1 },
});

// ---- اسکیمای دیکشنری ----
const dictionarySchema = new mongoose.Schema({
  // پاسخ‌ها به تفکیک لحن
  categories: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // ورودی‌های افزوده‌شده توسط کار شبانه
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

// ---- اسکیمای کاربر برای حافظه بلندمدت و پروفایل رفتاری ----
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

  // حافظه پیام روزانه
  dailyMessageMemory: {
    type: [{
      date: { type: String, required: true },
      messages: { type: [String], default: [] }
    }],
    default: []
  },
  last24hMessages: { type: [String], default: [] },

  // پروفایل رفتاری
  behaviorProfile: {
    type: {
      
      toneCounts: { type: mongoose.Schema.Types.Mixed, default: {} },
      
      toneDistribution: { type: mongoose.Schema.Types.Mixed, default: {} },
      
      recentTones: {
        type: [{
          date: String,
          tone: String,
          intensity: Number
        }],
        default: []
      },
      // سطح شخصیت هر کاربر
      levels: {
        rude: { type: Number, default: 0 },
        polite: { type: Number, default: 0 },
        romantic: { type: Number, default: 0 },
        sexy: { type: Number, default: 0 },
        sports: { type: Number, default: 0 },
        dirtyTalk: { type: Number, default: 0 },
        music: { type: Number, default: 0 }
      },
      // پرچم‌های رفتاری
      flags: {
        excessiveRude: { type: Boolean, default: false },
        excessivePolite: { type: Boolean, default: false },
        excessiveRomantic: { type: Boolean, default: false },
        excessiveSexy: { type: Boolean, default: false }
      },
      // علایق کاربر
      interests: { type: [String], default: [] },
      // آخرین به‌روزرسانی پروفایل
      lastProfileUpdate: { type: Date, default: Date.now }
    },
    default: {}
  },

  // تطبیق شخصیت ربات برای این کاربر
  personalityAdaptation: {
    type: {
      // ضریب بی‌ادبی
      rudeMultiplier: { type: Number, default: 1.0 },
      // تقویت عاشقانگی
      romanticBoost: { type: Number, default: 1.0 },
      // تقویت سکسی بودن
      sexyBoost: { type: Number, default: 1.0 },
      // تقویت مهربانی
      kindnessBoost: { type: Number, default: 1.0 },
      // علاقه به ورزش
      sportsInterest: { type: Number, default: 0.5 },
      // علاقه به موسیقی
      musicInterest: { type: Number, default: 0.5 },
      // سطح گفتار صریح
      dirtyTalkLevel: { type: Number, default: 0.3 },
      // سطح مودب بودن
      politenessLevel: { type: Number, default: 0.5 },
      // بخش‌های شخصیت سفارشی
      customSections: { type: mongoose.Schema.Types.Mixed, default: {} },
      // آخرین تطبیق
      lastAdaptation: { type: Date, default: Date.now }
    },
    default: {}
  },
});

// ---- اسکیمای وضعیت سیستم ----
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

  lastPersonalityUpdate: { type: Date, default: null },

  lastDictionaryUpdate: { type: Date, default: null },
});

// ---- تعریف مدل‌ها ----
const User = mongoose.model("User", userSchema);
const SystemStatus = mongoose.model("SystemStatus", systemStatusSchema);
const Personality = mongoose.model("Personality", personalitySchema);
const Dictionary = mongoose.model("Dictionary", dictionarySchema);

// ---- توابع کمکی وضعیت سیستم ----
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

// ---- افزایش شمارنده پیام روزانه ----
export async function incrementDailyMessages() {
  try {
    return await SystemStatus.findOneAndUpdate(
      {},
      { $inc: { totalDailyMessages: 1 } },
      { returnDocument: "after", upsert: true }
    );
  } catch (error) {
    console.warn("----------- could not increment daily messages:", error.message || error);
    return null;
  }
}

// ---- گرفتن/ساخت کاربر ----
export async function getUser(userId, chatId) {
  let user = await User.findOne({ userId, chatId });
  if (!user) {
    user = new User({ userId, chatId });
    await user.save();
  }
  return user;
}

// ---- به‌روزرسانی کاربر ----
export async function updateUser(userId, chatId, update) {
  return await User.findOneAndUpdate({ userId, chatId }, update, {
    returnDocument: "after",
    upsert: true,
  });
}

// ---- توابع کمکی شخصیت ----
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

// ---- خواندن personality.txt و تقسیم به بخش‌ها ----
export function loadPersonalityFromFile() {
  const personalityPath = path.join(__dirname, '..', 'personality.txt');
  try {
    if (fs.existsSync(personalityPath)) {
      return fs.readFileSync(personalityPath, 'utf-8');
    }
  } catch (err) {
    console.warn("----------------- personality.txt not found, using default");
  }
  // فالبک به پیش‌فرض personality.js
  return DEFAULT_PERSONALITY;
}

// ---- تقسیم متن شخصیت به بخش‌ها برای به‌روزرسانی شبانه ----
export function splitPersonalityIntoSections(text) {
  const sections = {};
  
  const personalityMatch = text.match(/شخصیت شما:([\s\S]*?)(?=قوانین رفتاری|استفاده از|$)/i);
  sections.personality = personalityMatch ? personalityMatch[1].trim() : "";


  const rulesMatch = text.match(/قوانین رفتاری[\s\S]*?:([\s\S]*?)(?=استفاده از|$)/i);
  sections.rules = rulesMatch ? rulesMatch[1].trim() : "";

 
  sections.music = extractSection(text, "موسیقی", "ورزش");
  sections.sports = extractSection(text, "ورزش", "گفت‌وگو");
  sections.bioUsage = extractSection(text, "بیوگرافی", "$");

 
  if (!sections.personality) sections.personality = text.trim();
  if (!sections.rules) sections.rules = "طبیعی، انسانی و غیررباتی صحبت کن؛ سوال بی‌ربط نپرس.";
  if (!sections.music) sections.music = "با کاربران علاقه‌مند به موسیقی: صحبت‌های مرتبط با آهنگ، خواننده، ترانه بزن.";
  if (!sections.sports) sections.sports = "با کاربران علاقه‌مند به ورزش: در مورد فوتبال/بازی/ورزش بحث کن.";
  if (!sections.bioUsage) sections.bioUsage = " خیلی کم و یا اگر خود کاربر درخواست تحلیل پروفایل داشت این کار رو انجام بده";

  return sections;
}

// ---- استخراج بخشی از متن بین دو کلمه کلیدی ----
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

// ---- توابع کمکی دیکشنری ----
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
    console.warn("-------- dictionary.json not found, using built-in default");
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

// ---- افزودن جواب جدید به یک دسته ----
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

// ---- گرفتن همه دسته‌های دیکشنری ----
export async function getAllDictionaryCategories() {
  const doc = await getDictionaryDoc();
  return doc.categories;
}

// ---- خروجی مدل‌ها ----
export { User, SystemStatus, Personality, Dictionary };
