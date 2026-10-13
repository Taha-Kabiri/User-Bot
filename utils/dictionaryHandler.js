import { getSystemStatus, updateSystemStatus, getDictionaryDoc, addDictionaryEntry as addDictionaryEntryDB, User } from "./database.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DEFAULT_PERSONALITY } from "../personality.js";

const apiKey = process.env.AI_API_KEY;
const modelName = process.env.AI_MODEL || "gemini-flash-latest";
const genAI = new GoogleGenerativeAI(apiKey);

// ==================== Cache ====================
let cachedDictionary = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;

// ==================== Dictionary Operations ====================
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

export async function getDictionaryResponse(behavior, context = {}) {
  const dictionary = await loadDictionary();

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

// Reload dictionary from DB
export async function reloadDictionary() {
  cachedDictionary = null;
  cacheTime = 0;
  const dict = await loadDictionary();
  console.log("✅ dictionary reloaded from DB");
  return dict;
}

export async function addDictionaryEntry(category, response) {
  const result = await addDictionaryEntryDB(category, response);
  cachedDictionary = result;
  cacheTime = Date.now();
  return result;
}

// ==================== Daily Generation ====================
// Generate daily dictionary entries from user messages
export async function generateDailyDictionaryEntries() {
  const status = await getSystemStatus();
  const now = new Date();

  if (status.lastDictionaryUpdate && (now - new Date(status.lastDictionaryUpdate)) < 22 * 3600 * 1000) {
    return false;
  }

  try {
    const allUsers = await User.find({ isActive: true }).limit(50);

    const toneSamples = {};
    for (const u of allUsers) {
      const msgs = u.last24hMessages || [];
      const tone = u.tone || 'neutral';

      if (!toneSamples[tone]) toneSamples[tone] = [];
      for (const m of msgs.slice(-3)) {
        toneSamples[tone].push(m);
      }
    }

    const model = genAI.getGenerativeModel({ model: modelName });

    const categories = ['rude', 'romantic', 'sexy', 'sports', 'dirty_talk', 'polite', 'music'];

    for (const cat of categories) {
      const samples = toneSamples[cat] || [];
      if (samples.length === 0) continue;

      const stylePrompt = getStylePrompt(cat);
      const prompt = `تو «طاها» هستی. یک آدم واقعی در تلگرم. بر اساس سبک زیر، ۳ تا واکنش جدید، طبیعی و غیرتکراری برای چت بنویس. فقط واکنش‌ها رو بنویس، بدون شماره یا توضیح:\n\nسبک: ${stylePrompt}\n\nنمونه‌های امروز: ${samples.slice(0, 3).join(' | ')}`;

      try {
        const result = await model.generateContent(prompt);
        const text = await result.response.text();
        const lines = text.split('\n')
          .map(l => l.replace(/^\d+[\.\)]?\s*/, '').trim())
          .filter(l => l.length > 3 && l.length < 500);

        for (const line of lines.slice(0, 3)) {
          if (line && line.length > 5) {
            await addDictionaryEntry(cat, line);
          }
        }
      } catch (err) {
        console.error(`❌ error generating daily entries for ${cat}:`, err.message);
      }
    }

    await updateSystemStatus({ lastDictionaryUpdate: now });
    console.log("✅ daily dictionary entries generated and saved to DB");
    return true;
  } catch (err) {
    console.error("❌ daily dictionary generation failed:", err);
    return false;
  }
}

// ==================== Helpers ====================
function getStylePrompt(cat) {
  const styles = {
    rude: 'بی‌ادب، تند، کنایه‌آمیز، جواب محکم به بی‌ادبی غریبه. بدون فحش به خانواده. لحن خونسرد.',
    romantic: 'عاشقانه طبیعی، مستقیم، صمیمی. بدون «عزیزم دلبرم» تکراری. لاس‌زننده اما نه مصنوعی.',
    sexy: 'جلب‌کننده، شیک، با حس. کلمات لطیفه‌وار، نه رکیک بی‌حد. مرز داشته باش.',
    sports: 'ورزشی، هوادارانه، طبیعی. مثل یه رفیق فوتبال حرف بزن.',
    dirty_talk: 'گفتار صریح، لامسه‌وار، جان‌انگیز. خوش‌ذوق، جلب‌کننده، نه زشت.',
    polite: 'مودب، دل‌نشین، دوستانه، طبیعی. نه رسمی، نه کتابی.',
    music: 'موسیقی‌محور، طبیعی، خلاقانه. مثل کسی که واقعاً آهنگ گوش میده.',
  };
  return styles[cat] || 'طبیعی، محاوره‌ای، تلگرامی.';
}

function getDefaultDictionary() {
  return {
    default: [
      "سلام، خوبی؟",
      "چطوری؟",
      "چه خبر؟",
      "خوبی؟",
      "سلام",
    ],
    polite: [
      "چشم، در خدمتم",
      "مرسی، تو چطوری؟",
      "خوبم، تو خوبی؟",
      "لطف داری",
      "چشم عزیزم",
    ],
    rude: [
      "به تو چه؟",
      "خفه شو بی‌ادب",
      "کص نگو بابا",
      "خودی تو نمیدونی با کی حرف میزنی",
      "حق داری، رفتم تو خط",
    ],
    romantic: [
      "ممنون، لطف داری",
      "قربونت، خفن خودتی",
      "تو هم قشنگی",
      "دلتنگتم",
      "جون دلم",
    ],
    music: [
      "خفن، چی گوش میدی؟",
      "آهنگ خوبی بود",
      "فکر کنم قبلاً شنیدمش",
      "سبکش چیه؟",
      "خوبیه، ممنون که گذاشتی",
    ],
    sexy: [
      "میدونم، ممنون",
      "تو هم بد نیستی",
      "جون دلم",
      "خفه شو بخندم",
      "بد جوری میگی",
    ],
    sports: [
      "بله، تیمی؟",
      "دیده‌ام، بازی خوبی بود",
      "هوادار کی هستی؟",
      "گل چیه؟",
      "ورزش میکنی؟",
    ],
    dirty_talk: [
      "جون دلم، ساک بزن",
      "بد جوری میگی",
      "خفه شو بخندم",
      "دیگه حوصله ندارم",
      "میدونم، ممنون",
    ],
    limit: [
      "خوب من باید برم",
      "صبر کن تا بیاد",
      "توکن تموم شد",
      "بای بای",
      "چند ساعته برمی‌گردم",
    ],
  };
}

export { DEFAULT_PERSONALITY };