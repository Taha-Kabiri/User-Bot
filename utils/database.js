import mongoose from "mongoose";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PERSONALITY } from '../personality.js';
import { type } from "os";
import { timeStamp } from "console";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mongoURI = process.env.MONGO_URI;
if (!mongoURI) {
  console.error(" MONGO_URI empty !!!!!!!!!!!!!!!!!!!!");
  process.exit(1);
}

await mongoose.connect(mongoURI);
console.log("connecting to MongoDB Atlas");

// ==================== Mongoose Models ====================
// Personality model
const personalitySchema = new mongoose.Schema({
  type: { type: String, enum: ["global", "user"], default: "global" },
  userId: { type: Number, default: null },
  chatId: { type: Number, default: null },
  sections: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  baseSections: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  snapshots: {
    type: [{
      date: { type: Date, default: Date.now },
      sections: { type: mongoose.Schema.Types.Mixed, default: {} }
    }],
    default: []
  },
  sectionNotes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  lastUpdated: { type: Date, default: Date.now },
  version: { type: Number, default: 1 },
});

// Dictionary model
const dictionarySchema = new mongoose.Schema({
  categories: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
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

// User model (extended for long-term memory and behavior profile)
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
  conversationPairs: {
    type: [{
      userMessage: { type: String, required: true },
      botResponse: { type: String, required: true },
      timestamp: { type: Date, default: Date.now }
    }],
    default: []
  },
  dailyMessageMemory: {
    type: [{
      date: { type: String, required: true },
      messages: { type: [String], default: [] }
    }],
    default: []
  },
  last24hMessages: { type: [String], default: [] },

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
      levels: {
        rude: { type: Number, default: 0 },
        polite: { type: Number, default: 0 },
        romantic: { type: Number, default: 0 },
        sexy: { type: Number, default: 0 },
        sports: { type: Number, default: 0 },
        dirtyTalk: { type: Number, default: 0 },
        music: { type: Number, default: 0 }
      },
      flags: {
        excessiveRude: { type: Boolean, default: false },
        excessivePolite: { type: Boolean, default: false },
        excessiveRomantic: { type: Boolean, default: false },
        excessiveSexy: { type: Boolean, default: false }
      },
      interests: { type: [String], default: [] },
      lastProfileUpdate: { type: Date, default: Date.now }
    },
    default: {}
  },

  personalityAdaptation: {
    type: {
      rudeMultiplier: { type: Number, default: 1.0 },
      romanticBoost: { type: Number, default: 1.0 },
      sexyBoost: { type: Number, default: 1.0 },
      kindnessBoost: { type: Number, default: 1.0 },
      sportsInterest: { type: Number, default: 0.5 },
      musicInterest: { type: Number, default: 0.5 },
      dirtyTalkLevel: { type: Number, default: 0.3 },
      politenessLevel: { type: Number, default: 0.5 },
      customSections: { type: mongoose.Schema.Types.Mixed, default: {} },
      lastAdaptation: { type: Date, default: Date.now }
    },
    default: {}
  },
});

// Unique index to prevent duplicate user documents
userSchema.index({ userId: 1, chatId: 1 }, { unique: true });

// System status model
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

const User = mongoose.model("User", userSchema);
const SystemStatus = mongoose.model("SystemStatus", systemStatusSchema);
const Personality = mongoose.model("Personality", personalitySchema);
const Dictionary = mongoose.model("Dictionary", dictionarySchema);

// ==================== Helper Functions ====================
// Helper functions
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
    try {
      user = await User.create({ userId, chatId });
    } catch (e) {
      if (e.code !== 11000) throw e;
      user = await User.findOne({ userId, chatId });
    }
  }
  return user;
}

export async function updateUser(userId, chatId, update) {
  return await User.findOneAndUpdate({ userId, chatId }, update, {
    returnDocument: "after",
    upsert: true,
  });
}

// ==================== Personality DB Functions ====================
// Personality DB functions
export async function getGlobalPersonality() {
  let p = await Personality.findOne({ type: "global" });
  if (!p) {
    const def = loadPersonalityFromFile();
    const sections = splitPersonalityIntoSections(def);
    p = new Personality({
      type: "global",
      sections: { ...sections },
      baseSections: { ...sections },
      snapshots: []
    });
    await p.save();
  } else if (!p.baseSections || Object.keys(p.baseSections).length === 0) {
    p.baseSections = { ...p.sections };
    await p.save();
    console.log("✅ baseSections initialized from current sections");
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

export async function updateGlobalPersonality(sections, notes, snapshots) {
  const update = {
    sections,
    sectionNotes: notes || {},
    lastUpdated: new Date(),
    $inc: { version: 1 }
  };
  if (snapshots) {
    update.snapshots = snapshots;
  }
  return await Personality.findOneAndUpdate(
    { type: "global" },
    update,
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

// ==================== Personality File Loading ====================
// Load personality.txt and split into sections
export function loadPersonalityFromFile() {
  const personalityPath = path.join(__dirname, '..', 'personality.txt');
  try {
    if (fs.existsSync(personalityPath)) {
      return fs.readFileSync(personalityPath, 'utf-8');
    }
  } catch (err) {
    console.warn("⚠️ personality.txt not found, using default");
  }
  return DEFAULT_PERSONALITY;
}

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

// ==================== Dictionary DB Functions ====================
// Dictionary DB functions
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
    default: ["درود٬ طاها نیست به عنوان دستیار در دخمت شما هستم ."],
    polite: ["چشم ، در خدمت شما هستم! 🙏"],
    rude: [" انقدر گاوی که داری با ربات حرف میزی "],
    romantic: ["چه چشمان قشنگی داری! 😍"],
    music: ["آهنگ خوبی انتخاب کردی! 🎵"],
    sexy: ["می‌دونی این لباس چه می‌کنه بهت؟ 😏"],
    sports: ["چه بازیک اگه؟ فوتبال امروز رو می‌بینی؟ ⚽"],
    dirty_talk: ["می‌دونی صبح تا شب فکرت هستم... "],
    limit: [" فعلا خداحافظ"]
  };
}

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

export async function getAllDictionaryCategories() {
  const doc = await getDictionaryDoc();
  return doc.categories;
}

export { User, SystemStatus, Personality, Dictionary };