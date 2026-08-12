// ======================================================================
// dictionaryHandler.js - مدیریت دیکشنری جواب‌ها
// ======================================================================

// ---- import ها و تنظیمات ----
import { getSystemStatus, updateSystemStatus, getDictionaryDoc, addDictionaryEntry as addDictionaryEntryDB, User } from "./database.js";
import { DEFAULT_PERSONALITY } from "../personality.js";

const apiKey = process.env.AI_API_KEY;
const modelName = process.env.AI_MODEL || "gemini-flash-latest";

// ---- fetch با تایم‌اوت ----
async function socketFetch(url, options, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---- درخواست از Gemini (با تلاش مجدد) ----
async function geminiGenerate(prompt, maxOutputTokens = 1024) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens },
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const resp = await socketFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
    if (resp.status === 429 || resp.status === 500 || resp.status === 503) {
      const delay = Math.min(2 ** attempt * 3, 60);
      console.warn(`Gemini ${resp.status} (attempt ${attempt + 1}/5); retrying in ${delay}s`);
      await new Promise((r) => setTimeout(r, delay * 1000));
      continue;
    }
    const data = await resp.json();
    if (resp.ok) {
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
    console.warn(" Gemini API error in dictionaryHandler:", JSON.stringify(data).slice(0, 200));
    return null;
  }
  return null;
}

// ---- کش محلی دیکشنری ----
let cachedDictionary = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;

// ---- بارگذاری دیکشنری از دیتابیس ----
export async function loadDictionary() {
  const now = Date.now();
  if (cachedDictionary && (now - cacheTime) < CACHE_TTL) {
    return cachedDictionary;
  }
  const doc = await getDictionaryDoc();
  cachedDictionary = doc.categories || getDefaultDictionary();
  cacheTime = now;
  return cachedDictionary;
}

// ---- گرفتن جواب متناسب با لحن ----
export async function getDictionaryResponse(behavior, context = {}) {
  const dictionary = await loadDictionary();

  // پشتیبانی از behavior به صورت string یا object
  let tone = behavior;
  if (typeof behavior === 'object' && behavior !== null) {
    tone = behavior.tone;
  }

  let category = 'default';
  if (context.isLimit) category = 'limit';
  else if (tone === 'rude' || (context.rudeMultiplier && context.rudeMultiplier > 1.5)) category = 'rude';
  else if (tone === 'romantic') category = 'romantic';
  else if (tone === 'music') category = 'music';
  else if (tone === 'sexy') category = 'sexy';
  else if (tone === 'sports') category = 'sports';
  else if (tone === 'dirty_talk') category = 'dirty_talk';
  else if (tone === 'polite') category = 'polite';

  const responses = dictionary[category] || dictionary.default || [];
  if (responses.length === 0) return '';
  return responses[Math.floor(Math.random() * responses.length)];
}

// ---- ریست کش ----
export async function reloadDictionary() {
  cachedDictionary = null;
  cacheTime = 0;
  const dict = await loadDictionary();
  console.log("**************** dictionary reloaded from DB");
  return dict;
}

// ---- افزودن جواب جدید ----
export async function addDictionaryEntry(category, response) {
  const result = await addDictionaryEntryDB(category, response);

  cachedDictionary = result;
  cacheTime = Date.now();
  return result;
}

// ---- تولید جواب‌های روزانه از تعاملات امروز ----
export async function generateDailyDictionaryEntries() {
  const status = await getSystemStatus();
  const now = new Date();

  // فقط یک بار در روز
  if (status.lastDictionaryUpdate && (now - new Date(status.lastDictionaryUpdate)) < 22 * 3600 * 1000) {
    return false;
  }

  try {
    const allUsers = await User.find({ isActive: true }).limit(50);

    // جمع‌آوری تعاملات اخیر به تفکیک لحن
    const toneSamples = {};
    for (const u of allUsers) {
      const msgs = u.last24hMessages || [];
      const profile = u.behaviorProfile || {};
      const tone = u.tone || 'neutral';

      if (!toneSamples[tone]) toneSamples[tone] = [];
      for (const m of msgs.slice(-3)) {
        toneSamples[tone].push(m);
      }
    }

    // تولید چند جواب جدید برای هر لحن
    const categories = ['rude', 'romantic', 'sexy', 'sports', 'dirty_talk', 'polite', 'music'];

    for (const cat of categories) {
      const samples = toneSamples[cat] || [];
      if (samples.length === 0) continue;

      const prompt = `تو یک نویسنده محتوای گفتاری هوش مصنوعی هستی. بر اساس سبک زیر، ۳ تا واکنش جدید، طبیعی و غیرتکراری برای یک چت تلگرامی بنویس. فقط واکنش‌ها را بدون شماره یا توضیح اضافه بنویس:\n\nسبک: ${cat === 'rude' ? 'بی‌ادب، تند و بی‌پروا' : cat === 'romantic' ? 'عاشقانه، لاس‌زننده و احساسی' : cat === 'sexy' ? 'جلب‌کننده، شیک و جنده' : cat === 'sports' ? 'ورزشی، هوادارانه و پویا' : cat === 'dirty_talk' ? 'گفتار صریح، لامسه‌وار و جان‌انگیز' : cat === 'polite' ? 'مودب، دل‌نشین و دوستانه' : cat === 'music' ? 'موسیقی‌محور، هیجان‌زده و خلاقانه' : ''}\n\nنمونه‌های امروز: ${samples.slice(0, 3).join(' | ')}`;

      try {
        const text = await geminiGenerate(prompt);
        const lines = text.split('\n')
          .map(l => l.replace(/^\d+[\.\)]?\s*/, '').trim())
          .filter(l => l.length > 3 && l.length < 500);

        for (const line of lines.slice(0, 3)) {
          if (line && line.length > 5) {
            await addDictionaryEntry(cat, line);
          }
        }
      } catch (err) {
        console.error(`-------error generating daily entries for ${cat}:`, err.message);
      }
    }

    await updateSystemStatus({ lastDictionaryUpdate: now });
    console.log("********* daily dictionary entries generated and saved to DB");
    return true;
  } catch (err) {
    console.error("-------- daily dictionary generation failed:", err);
    return false;
  }
}

// ---- دیکشنری پیش‌فرض ----
function getDefaultDictionary() {
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

// ---- برای سازگاری ----
export { DEFAULT_PERSONALITY };
