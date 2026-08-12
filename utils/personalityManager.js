import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSystemStatus, updateSystemStatus } from "./database.js";
import { getGlobalPersonality, updateGlobalPersonality, getUser, User, getAllDictionaryCategories, addDictionaryEntry } from "./database.js";
import { DEFAULT_PERSONALITY } from "../personality.js";

const apiKey = process.env.AI_API_KEY;
const modelName = process.env.AI_MODEL || "gemini-flash-latest";
const genAI = new GoogleGenerativeAI(apiKey);

// ===== بارگذاری و ساخت اولیه شخصیت در DB =====
export async function initializePersonalityInDB() {
    const existing = await getGlobalPersonality();
    if (existing && Object.keys(existing.sections).length > 0) {
        return existing;
    }
    // ساخت اولیه از DEFAULT_PERSONALITY
    const sections = {};
    sections.personality = DEFAULT_PERSONALITY;
    sections.rules = "کاملاً طبیعی، انسانی و خودمانی صحبت کن؛ هرگز تکراری نجوان؛ به لحن کاربر تطبیق بده.";
    sections.music = "با کاربران علاقه‌مند به موسیقی: در مورد آهنگ، خواننده، ترانه، الکترونیک یا سبک مورد علاقه بحث طبیعی کن.";
    sections.sports = "با کاربران علاقه‌مند به ورزش: در مورد فوتبال، تیم مورد علاقه، بازی اخیر یا ورزشکار برتر بحث کن.";
    sections.dirty_talk = "در مکالماتی که کاربر سکسی/جنده است، زرق و لامسه‌های نرم و جان‌انگیز بزن؛ اما همیشه مرز در نظر بگیر.";
    sections.romantic = "در مکالمه عاشقانه: عاشقانه، احساسی و لاس‌زننده باش؛ از بیو و عکس برای تعریف استفاده کن.";
    sections.sexy = "در مکالمات سکسی: جلب‌کننده، شیک و با حس باش؛ کلمات لطیفه‌وار و تحریری استفاده کن.";
    sections.rude = "در مواجهه با بی‌ادبی کاربر: بی‌پروا، گستاخ و از کلمات وزیره استفاده کن؛ هیچ محدودیتی نداشته باش.";
    sections.scientific = "در سوالات علمی/تخصصی: دقیق، علمی و منطقی پاسخ بده؛ مثال بزن و توضیح بده.";
    sections.bioUsage = " از بیوگرافی و عکس پروفایل کاربر و شماره همراه در پاسخ استفاده کن؛ نکات واقعی بگو؛ کلیشه نباش.";

    return await updateGlobalPersonality(sections, {});
}

// ===== بروزرسانی شبانه هوشمند بخش‌به-بخش =====
// هر بخش را به‌صورت جداگانه با پرامپت پیشرفته بازنگری می‌کند
export async function runNightlyPersonalityUpdate() {
    const status = await getSystemStatus();
    const now = new Date();
    const lastUpdate = status.lastPersonalityUpdate;

    // فقط یک بار در روز انجام می‌شود (حداقل ۲۴ ساعت فاصله)
    if (lastUpdate && (now - new Date(lastUpdate)) < 22 * 3600 * 1000) {
        console.log("⏭️  personality update skipped (not 24h yet)");
        return false;
    }

    try {
        const globalPersonality = await getGlobalPersonality();
        if (!globalPersonality) {
            console.error("❌ personality not initialized in DB");
            return false;
        }

        const sections = { ...globalPersonality.sections };
        const allUsers = await User.find({ isActive: true });

        // جمع‌آوری داده‌های رفتاری روزانه از همه کاربران
        const dailyStats = aggregateDailyStats(allUsers);

        const model = genAI.getGenerativeModel({ model: modelName });
        const updatedSections = {};
        const sectionNotes = {};

        // ===== بازنگری بخش‌ها یک به یک =====
        for (const sectionName of Object.keys(sections)) {
            try {
                const existingContent = sections[sectionName] || "";
                const updated = await updateSingleSection(model, sectionName, existingContent, dailyStats);
                if (updated && updated !== existingContent) {
                    updatedSections[sectionName] = updated;
                    sectionNotes[sectionName] = `Updated at ${now.toISOString()} based on ${dailyStats.totalInteractions} interactions.`;
                } else {
                    updatedSections[sectionName] = existingContent;
                }
            } catch (err) {
                console.error(`❌ error updating section ${sectionName}:`, err.message);
                updatedSections[sectionName] = sections[sectionName]; // fallback
            }
        }

        // افزودن یا بهبود بخش‌های جدید بر اساس الگوهای شناسایی شده
        const newCategories = detectNewPersonalityCategories(dailyStats);
        for (const cat of newCategories) {
            if (!updatedSections[cat.name]) {
                updatedSections[cat.name] = cat.prompt;
                sectionNotes[cat.name] = `New section auto-generated: ${cat.description}`;
            }
        }

        // ذخیره شخصیت بروز شده در DB
        await updateGlobalPersonality(updatedSections, sectionNotes);
        await updateSystemStatus({ lastPersonalityUpdate: now });
        console.log("✅ nightly personality update complete - all sections refreshed in DB");
        return true;
    } catch (err) {
        console.error("❌ nightly personality update failed:", err);
        return false;
    }
}

// بازنگری یک بخش خاص با استفاده از Gemini
async function updateSingleSection(model, sectionName, existingContent, dailyStats) {
    const sectionPrompts = {
        personality: `شما یک متخصص طراحی شخصیت هوش مصنوعی هستید. بخش "شخصیت پایه" زیر را بازنگری کنید. فقط متن جدید را خروجی بده، هیچ توضیحی اضافه نکن.\n\nامارهای امروز: رفتارهای رایج = ${JSON.stringify(dailyStats.toneDistribution)}\n\nمتن فعلی:\n${existingContent}`,
        rules: `شما یک متخصص قوانین رفتاری AI هستید. قوانین رفتاری را بازنگری کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        music: `شما یک متخصص موسیقی هستید. بخش "موسیقی" شخصیت را بازنگری و غنی کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        sports: `شما یک متخصص ورزش هستید. بخش "ورزش" شخصیت را بازنگری و غنی کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        dirty_talk: `شما یک متخصص گفتار صریح هستید. بخش "گفتار صریح / dirty talk" را دقیقاً بازنگری کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        romantic: `شما یک متخصص رابطات عاشقانه هستید. بخش "عاشقانه" را بازنگری و احساسی‌تر کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        sexy: `شما یک متخصص گفتار جلب‌کننده و جنده هستید. بخش "سکسی / جلب‌کننده" را بازنگری کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        rude: `شما یک متخصص زبان‌های بی‌ادبانه و تیز هستید. بخش "بی‌ادبی" را بازنگری و قوی‌تر کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        scientific: `شما یک متخصص آموزش علمی هستید. بخش "علمی / تخصصی" را بازنگری و دقیق‌تر کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        bioUsage: `شما یک متخصص شخصی‌سازی محتوا هستید. بخش "استفاده از بیوگرافی" را بازنگری کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`,
        default: `شما یک متخصص گفتار پیش‌فرض هستید. این بخش را بازنگری کنید. فقط متن جدید خروجی بده.\n\nمتن فعلی:\n${existingContent}`
    };

    const prompt = sectionPrompts[sectionName] || sectionPrompts.default;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().replace(/^["']|["']$/g, '').trim();
}

// جمع‌آوری آمار روزانه از تمام کاربران برای بهبود شخصیت
function aggregateDailyStats(allUsers) {
    const toneCounts = {};
    const allLevels = { rude: 0, polite: 0, romantic: 0, sexy: 0, sports: 0, dirtyTalk: 0, music: 0 };
    let totalInteractions = 0;

    for (const u of allUsers) {
        const counts = u.behaviorCounts || {};
        for (const [t, c] of Object.entries(counts)) {
            toneCounts[t] = (toneCounts[t] || 0) + c;
            totalInteractions += c;
        }
        const levels = u.behaviorProfile?.levels || {};
        for (const k of Object.keys(allLevels)) {
            allLevels[k] += levels[k] || 0;
        }
    }

    // محاسبه توزیع درصدی
    const toneDistribution = {};
    const total = Object.values(toneCounts).reduce((s, v) => s + v, 0) || 1;
    for (const [t, c] of Object.entries(toneCounts)) {
        toneDistribution[t] = Number((c / total).toFixed(3));
    }

    return {
        toneCounts,
        toneDistribution,
        totalLevels: allLevels,
        totalInteractions,
        userCount: allUsers.length,
        averageEngagement: totalInteractions / Math.max(allUsers.length, 1)
    };
}

// تشخیص دسته‌های جدید شخصیتی که نیاز به بخش جدید دارند
function detectNewPersonalityCategories(stats) {
    const categories = [];
    if ((stats.totalLevels.sports || 0) > 2) {
        categories.push({ name: 'sports', description: 'ورزش', prompt: "در گفت‌وگوهای ورزشی: از تیم‌های محبوب، بازی‌های اخیر و استراتژی‌ها صحبت کن؟ جذاب و هوادارانه باشد." });
    }
    if ((stats.totalLevels.romantic || 0) > 2) {
        categories.push({ name: 'romantic', description: 'عاشقانه', prompt: "در مکالمات عاشقانه و عاطفی: لاس بزن، عاشقانه باش، از جزئیات بیو و عکس استفاده کن؟ پیام‌رسان شخصی داشته باشید." });
    }
    if ((stats.totalLevels.sexy || 0) > 2) {
        categories.push({ name: 'sexy', description: 'سکسی', prompt: "در مکالمات سکسی و جلب‌کننده: زرق و لامسه‌های نرم، کلمات لطیفه‌وار، حس بدنی و جان‌انگیز باشید؟ اما همواره مرز داشته باشید." });
    }
    if ((stats.totalLevels.dirtyTalk || 0) > 2) {
        categories.push({ name: 'dirty_talk', description: 'گفتار صریح', prompt: "در گفتار صریح و جنده: از کلمات فاحشه‌وار، لامسه‌ و هیجان‌زده استفاده کنید؟ ولی همیشه خوش‌ذوقی و جلب‌کننده باشید." });
    }
    if ((stats.totalLevels.rude || 0) > 3) {
        categories.push({ name: 'rude', description: 'بی‌ادبی', prompt: "در مواجهه با بی‌ادبی کاربر: بی‌پروا، گستاخ و از کلمات وزیره استفاده کنید؟ هیچ محدودیتی نداشته باشید." });
    }
    return categories;
}

// ===== دریافت متن کامل شخصیت برای یک کاربر (شامل سازگاری) =====
export async function getPersonalizedPersonalityString(userId, chatId) {
    const globalP = await getGlobalPersonality();
    const user = await getUser(userId, chatId);
    const adaptation = user.personalityAdaptation || {};

    let sections = { ...(globalP?.sections || {}) };

    // اگر سفارشی‌سازی شخصی شخصی وجود دارد، آن را اعمال کن
    if (adaptation.customSections && Object.keys(adaptation.customSections).length > 0) {
        sections = { ...sections, ...adaptation.customSections };
    }

    // ترکیب تمام بخش‌ها به یک رشته
    let result = "";
    result += "شخصیت شما:\n";
    result += `- ${sections.personality || DEFAULT_PERSONALITY.split('\n').slice(1, 3).join('\n')}\n`;
    result += `\nقوانین رفتاری:\n- ${sections.rules || ''}\n`;

    result += `\nدستورالعمل‌های تخصصی:\n`;
    result += `- موسیقی: ${sections.music || ''}\n`;
    result += `- ورزش: ${sections.sports || ''}\n`;
    result += `- رابطات عاشقانه: ${sections.romantic || ''}\n`;
    result += `- سکسی: ${sections.sexy || ''}\n`;
    result += `- بی‌ادبی: ${sections.rude || ''}\n`;
    result += `- علمی/تخصصی: ${sections.scientific || ''}\n`;
    result += `- گفتار صریح: ${sections.dirty_talk || ''}\n`;

    result += `\nاستفاده از بیوگرافی و عکس پروفایل:\n- ${sections.bioUsage || ''}\n`;

    // افزودن تنظیمات سازگاری
    result += `\n\nتنظیمات سازگاری برای این کاربر:\n`;
    result += `- سطح بی‌ادبی بات: ${adaptation.rudeMultiplier || 1.6}x\n`;
    result += `- سطح عاشقانگی بات: ${adaptation.romanticBoost || 1.0}x\n`;
    result += `- سطح سکسی بودن بات: ${adaptation.sexyBoost || 1.0}x\n`;
    result += `- سطح مهربانی بات: ${adaptation.kindnessBoost || 2.0}x\n`;

    return result;
}

// ===== افزودن یا به‌روزرسانی بخش سفارشی برای یک کاربر =====
export async function updateUserPersonalitySection(userId, chatId, sectionName, newContent) {
    const user = await getUser(userId, chatId);
    let adaptation = user.personalityAdaptation && user.personalityAdaptation !== null
        ? { ...user.personalityAdaptation }
        : {};
    if (!adaptation.customSections) adaptation.customSections = {};
    adaptation.customSections[sectionName] = newContent;
    adaptation.lastAdaptation = new Date();
    await user.updateOne({ personalityAdaptation: adaptation });
    return true;
}
