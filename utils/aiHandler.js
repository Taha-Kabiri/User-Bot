import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSystemStatus, updateSystemStatus } from "./database.js";
import { getDictionaryResponse } from "./dictionaryHandler.js";
import { DEFAULT_PERSONALITY } from "../personality.js";
import { getPersonalizedPersonalityString, initializePersonalityInDB } from "./personalityManager.js";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.AI_API_KEY;
const modelName = process.env.AI_MODEL || "gemini-flash-latest";

if (!apiKey) {
    console.error(" AI_API_KEY is empty");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
console.log(" Gemini AI runnig is successfly");

// بارگذاری/ساخت اولیه personality در DB 
initializePersonalityInDB().catch(err => {
    console.warn("⚠️ Could not init personality in DB, using default text");
});

// تابع دریافت پاسخ از Gemini
export async function getAIResponse(userMessage, userContext = {}) {
    try {
        const status = await getSystemStatus();

        if (status.geminiQuotaExceeded || status.dictionaryMode) {
            console.log("⚠️ limiting API_KEY");
            return null;
        }

        const model = genAI.getGenerativeModel({ model: modelName });

        // تشخیص لحن
        let behavior = userContext.tone || 'neutral';
        let intensity = userContext.intensity || 1.0;
        if (typeof userContext.behavior === 'object' && userContext.behavior !== null) {
            behavior = userContext.behavior.tone || 'neutral';
            intensity = userContext.behavior.intensity || 1.0;
        } else if (userContext.behavior) {
            behavior = userContext.behavior;
        }

        // ساخت پرامپت با شخصیت، قوانین رفتاری و زمینه
        let prompt = `${DEFAULT_PERSONALITY}\n\n`;

        // ===== دریافت شخصیت شخصی‌سازی شده برای این کاربر از DB =====
        let personalizedPersonality = null;
        try {
            if (userContext.userId && userContext.chatId) {
                personalizedPersonality = await getPersonalizedPersonalityString(
                    userContext.userId,
                    userContext.chatId
                );
            }
        } catch (err) {
            console.warn("⚠️ Could not load user personality, using global");
            personalizedPersonality = null;
        }

        prompt += `قوانین رفتاری (حتماً رعایت کن):\n`;
        prompt += `- هرگز به خانواده کاربر (مادر، پدر، خواهر، برادر و ...) فحش نده. این تنها محدودیت توست و در غیر این صورت می‌توانی هر چقدر که دوست داری بی‌ادب باشی.\n`;
        prompt += `- کاملاً طبیعی، انسانی و خودمانی صحبت کن؛ انگار یک دوست واقعی در حال پیام دادن است.\n`;
        prompt += `- سؤال بی‌ربط نپرس؛ مستقیم و مرتبط با پیام کاربر جواب بده.\n`;
        prompt += `- هیچ‌وقت پاسخ تکراری نده؛ هر بار جمله‌بندی و کلمات متفاوت استفاده کن.\n`;
        prompt += `- از کلیشه و تعریف‌های تکراری بپرهیز؛ نظرت خاص و منحصربه‌فرد باشد.\n`;
        prompt += `- ایموجی متناسب با لحن استفاده کن (خنده برای شوخی، قلب برای عاشقانه، بی‌ادبی برای دعوا و ...).\n`;
        prompt += `- در مکالمات عاشقانه لاس بزن و احساسی جواب بده؛ به سوالات تخصصی/علمی دقیق و علمی جواب بده.\n`;
        prompt += `- تو نماینده طاها هستی؛ وقتی او پای گوشی نیست، گفتگو را با همان سبک ادامه می‌دهی.\n`;

        // ===== بخش شخصیت شخصی‌سازی شده کاربر =====
        if (personalizedPersonality) {
            prompt += `\n${personalizedPersonality}\n`;
        }

        // ===== زمینه کاربر  =====
        prompt += `\nزمینه کاربر:\n`;
        prompt += `- بیوگرافی: ${userContext.bio || 'ندارد'}\n`;
        prompt += `- رفتار فعلی: ${behavior} (شدت: ${intensity})\n`;
        prompt += `- پیام قبلی کاربر: ${userContext.previousMessage || 'ندارد'}\n`;
        if (userContext.profilePhoto) {
            prompt += `- تحلیل عکس پروفایل: ${userContext.profilePhoto}\n`;
        }

        // ===== الگوی رفتاری و میانگین پروفایل کاربر =====
        const profile = userContext.behaviorProfile || {};
        if (profile.levels) {
            prompt += `\nپروفایل رفتاری میانگین کاربر:\n`;
            prompt += `- سطح بی‌ادبی: ${profile.levels.rude || 0}\n`;
            prompt += `- سطح مودبی: ${profile.levels.polite || 0}\n`;
            prompt += `- سطح عاشقانه: ${profile.levels.romantic || 0}\n`;
            prompt += `- سطح سکسی: ${profile.levels.sexy || 0}\n`;
            prompt += `- سطح ورزشی: ${profile.levels.sports || 0}\n`;
            prompt += `- سطح موسیقی: ${profile.levels.music || 0}\n`;
            prompt += `- سطح گفتار صریح: ${profile.levels.dirtyTalk || 0}\n`;
        }
        if (profile.flags) {
            prompt += `\nفعال‌سازهای رفتاری:\n`;
            if (profile.flags.excessiveRude) prompt += `- ⚠️ افراطی بودن بی‌ادبی تشخیص داده شده است!\n`;
            if (profile.flags.excessivePolite) prompt += `- ℹ️ افراطی بودن مودبی تشخیص داده شده است!\n`;
            if (profile.flags.excessiveRomantic) prompt += `- ❤️ رفتار عاشقانه شدید\n`;
            if (profile.flags.excessiveSexy) prompt += `- 🔥 رفتار سکسی شدید\n`;
        }
        if (profile.interests && profile.interests.length > 0) {
            prompt += `\nعلاقه‌مندی‌های کاربر: ${profile.interests.slice(-10).join('، ')}\n`;
        }

        // ===== الگوی رفتاری کلی  =====
        if (userContext.behaviorCounts && Object.keys(userContext.behaviorCounts).length > 0) {
            prompt += `- الگوی رفتاری کاربر: ${JSON.stringify(userContext.behaviorCounts)}\n`;
        }

        // ===== سازگاری شخصیت بات برای این کاربر =====
        const adaptation = userContext.personalityAdaptation || {};
        if (Object.keys(adaptation).length > 0) {
            prompt += `\nتنظیمات سازگاری بات برای این کاربر:\n`;
            prompt += `- ضریب بی‌ادبی بات: ${adaptation.rudeMultiplier || 2.0}x\n`;
            prompt += `- شارژ عاشقانه بات: ${adaptation.romanticBoost || 1.0}x\n`;
            prompt += `- شارژ سکسی بات: ${adaptation.sexyBoost || 2.0}x\n`;
            prompt += `- شارژ مهربانی بات: ${adaptation.kindnessBoost || 1.0}x\n`;
            prompt += `- سطح به‌نشر ورزش بات: ${adaptation.sportsInterest || 0.5}\n`;
            prompt += `- سطح به‌نشر موسیقی بات: ${adaptation.musicInterest || 0.5}\n`;
            prompt += `- سطح گفتار صریح بات: ${adaptation.dirtyTalkLevel || 1.3}\n`;
            prompt += `- سطح مودبی بات: ${adaptation.politenessLevel || 1.5}\n`;

            // ===== دستورالعمل‌های سازگاری انطباقی =====
            prompt += `\nدستورالعمل‌های سازگاری انطباقی:\n`;
            if (adaptation.rudeMultiplier > 1.2) {
                prompt += `- ❗ کاربر بی‌ادب است؛ بات باید بی‌پروا و گستاخ‌تر واکنش نشان دهد (حداکثر ${adaptation.rudeMultiplier}x بی‌ادبی).\n`;
            }
            if (adaptation.kindnessBoost > 1.2) {
                prompt += `- ❗ کاربر مودب و خوب است؛ بات باید مهربان‌تر و دل‌نشین‌تر باشد (حداکثر ${adaptation.kindnessBoost}x مهربانی).\n`;
            }
            if (adaptation.romanticBoost > 1.2) {
                prompt += `- ❗ کاربر عاشقانه است؛ بات باید عاشقانه‌تر و لاس‌زننده‌تر باشد (${adaptation.romanticBoost}x عاشقی).\n`;
            }
            if (adaptation.sexyBoost > 1.2) {
                prompt += `- ❗ کاربر سکسی است؛ بات باید جلب‌کننده‌تر و جذاب و دل ربا باشد (${adaptation.sexyBoost}x سکسی).\n`;
            }
            if (adaptation.excessiveRude) {
                prompt += `- ⚠️ افراط بی‌ادبی کاربر تشخیص داده شده؛ بات را بسیار بی‌پروا و خشن‌تر کنید.\n`;
            }
        }

        // ===== حافظه روزانه  =====
        if (userContext.dailyMessages && userContext.dailyMessages.length > 0) {
            prompt += `\nحافظه روزانه (آخرین ۲ پیام امروز از کاربر):\n`;
            userContext.dailyMessages.forEach((m, i) => {
                prompt += `- پیام ${i + 1}: ${m}\n`;
            });
        }

        // ===== مقایسه بیو و عکس قبلی =====
        prompt += `\nقوانین استفاده از بیوگرافی و عکس پروفایل:\n`;
        prompt += `- لازم نیست در هر پاسخ به تحلیل بیوگرافی و عکس اشاره کنی؛ فقط وقتی موضوع به‌طور طبیعی به آن‌ها مربوط می‌شود ازشان استفاده کن.\n`;
        prompt += `- در گفتگوی عادی مثل یک انسان رفتار کن و بیو/عکس را فقط در صورت مرتبط بودن وارد مکالمه کن.\n`;
        prompt += `- در مکالمه دوستانه/عاشقانه در صورت مرتبط بودن تعریف کن؛ در مکالمه بی‌ادبانه مسخره و تمسخر کن.\n`;
        prompt += `- درباره بیو و عکس به‌صورت طبیعی حرف بزن (مثل دوست واقعی)، نه کلیشه‌ای و تکراری.\n`;
        prompt += `- فقط از نکات واقعاً موجود در بیو/عکس استفاده کن؛ از تحلیل‌های کلیشه‌ای و تکراری بپرهیز.\n`;

        // تغییرات اخیر
        prompt += `\nنکات تکمیلی شخصی‌سازی:\n`;
        prompt += `- مثل یک انسان واقعی، طول پاسخ را با موقعیت هماهنگ کن: گاهی کوتاه و خلاصه، گاهی طولانی و مفصل (وقتی موضوع عمق می‌خواهد).\n`;
        prompt += `- اگر موضوع بیوگرافی یا عکس پروفایل به‌طور طبیعی در گفتگو پیش بیاید، از تحلیل آن‌ها برای نظر و تعریف/مسخره استفاده کن؛ وگرنه فقط به همان موضوع جاری جواب بده.\n`;
        prompt += `- در مکالمه عاشقانه در صورت مرتبط بودن از جزئیات عکس برای تعریف استفاده کن؛ در مکالمه بی‌ادبانه در صورت مرتبط بودن برای مسخره و تحقیر.\n`;
        prompt += `- به جزئیات پنهان عکس (حیوان خانگی، مکان خاص، اشیاء قابل‌تشخیص) فقط وقتی اشاره کن که طبیعی به بحث جاری مربوط باشد.\n`;
        prompt += `- نوع بیوگرافی را تشخیص بده (فلسفی، عاشقانه، طنز، رسمی) و در صورت مرتبط بودن، سبک پاسخ را با آن هماهنگ کن.\n`;
        prompt += `- احساسات کاربر را از بیو درک کن (غم، شادی، عاشقی، طنز) و در صورت نیاز همدلانه جواب بده.\n`;
        prompt += `- در مکالمات دوستانه و صمیمی، فقط اگر موضوع پیش آمد، پیشنهاد بهبود بیوگرافی بده.\n`;
        prompt += `- کاملاً انسانی و غیررباتیک صحبت کن؛ ترکیب طبیعی از زمینه مکالمه، شخصیت پایه و (در صورت مرتبط بودن) تحلیل پروفایل.\n`;

        if (userContext.profileChanged) {
            prompt += `- اگر عکس پروفایل کاربر عوض شده و موضوع به آن نزدیک بود، به تغییرات اشاره کن و طبیعی درباره‌شان حرف بزن.\n`;
        }
        if (userContext.bioChanged) {
            prompt += `- اگر بیوگرافی کاربر عوض شده و موضوع به آن نزدیک بود، به تغییر جدید اشاره کن و درباره‌اش حرف بزن.\n`;
        }
        if (userContext.previousPhotoAnalysis) {
            prompt += `- تحلیل قبلی عکس: ${userContext.previousPhotoAnalysis}\n`;
        }
        if (userContext.previousBio) {
            prompt += `- بیوگرافی قبلی: ${userContext.previousBio}\n`;
        }

        prompt += `\nپیام کاربر: ${userMessage}\n\n`;
        prompt += `پاسخ شما (مطابق با شخصیت، قوانین رفتاری و زمینه، و با در نظر گرفتن تمام تنظیمات سازگاری انطباقی):`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();

    } catch (error) {
        console.error(" error for Gemini:", error);

        if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('429')) {
            await updateSystemStatus({
                geminiQuotaExceeded: true,
                dictionaryMode: true
            });
            console.log("⚠️ limit is full connected to dictionary");
        }
        return null;
    }
}

// تابع تحلیل عکس پروفایل با Gemini Vision
export async function analyzeProfilePhoto(client, userId, profilePhoto = null, previousAnalysis = '') {
    try {
        const status = await getSystemStatus();
        if (status.geminiQuotaExceeded || status.dictionaryMode) {
            return null;
        }

        let photo = profilePhoto;
        if (!photo) {
            const full = await client.api.users.getFullUser({ id: userId });
            photo = full?.fullUser?.profilePhoto;
        }
        if (!photo) return null;

        const file = await client.downloadMedia(photo, {
            outputFile: `/tmp/profile_${userId}.jpg`
        });
        if (!file) return null;

        const imageBuffer = typeof file === 'string' ? fs.readFileSync(file) : Buffer.isBuffer(file) ? file : Buffer.from(file);
        const model = genAI.getGenerativeModel({ model: modelName });
        const image = {
            inlineData: {
                data: imageBuffer.toString('base64'),
                mimeType: 'image/jpeg'
            }
        };

        let visionPrompt =
            "تو یک تحلیل‌گر فوق‌دقیق عکس پروفایل هستی. عکس پروفایل کاربر را با جزئیات کامل و منحصربه‌فرد تحلیل کن: " +
            "رنگ و حالت مو، رنگ چشم، نوع آرایش (اگر وجود دارد)، رنگ و نوع لباس، سبک پوشش، پس‌زمینه عکس، حالت چشم‌ها، لبخند یا حالت چهره، استایل کلی، اکسسوری‌ها، نورپردازی و حس‌وحال عکس. " +
            "به جزئیات پنهان عکس هم توجه کن (حیوان خانگی، مکان خاص، اشیاء قابل‌تشخیص). " +
            "فقط نکات واقعاً قابل مشاهده در عکس را بگو، نه حدس کلیشه‌ای. نتیجه را به فارسی و در ۴ تا ۶ جمله بده.";

        if (previousAnalysis) {
            visionPrompt +=
                `\nتحلیل قبلی عکس پروفایل این کاربر: ${previousAnalysis}\n` +
                "عکس جدید را با تحلیل قبلی مقایسه کن و در انتها تغییرات ظاهری (رنگ مو، عینک، استایل، لباس و ...) را جداگانه ذکر کن.";
        }

        const result = await model.generateContent([visionPrompt, image]);
        const analysis = await result.response.text();
        if (typeof file === 'string') {
            try { fs.unlinkSync(file); } catch (e) { }
        }
        return analysis;

    } catch (error) {
        console.error("❌ error to analiz", error);
        return null;
    }
}

// تابع بررسی و ریکاوری توکن‌ها
export async function checkAndRecoverGemini() {
    try {
        const status = await getSystemStatus();
        if (!status.geminiQuotaExceeded) return;

        const model = genAI.getGenerativeModel({ model: modelName });
        await model.generateContent("Test");

        await updateSystemStatus({
            geminiQuotaExceeded: false,
            dictionaryMode: false
        });
        console.log("....  ✅ AI is oky , dictionary is OFF  ....");

    } catch (error) {
        console.log("....  ⏳ AI is OFF dictionary is ON  ....");
    }
}
