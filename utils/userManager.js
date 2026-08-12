// ======================================================================
// userManager.js - مدیریت حافظه و رفتار کاربران
// ======================================================================

// ---- import ها ----
import crypto from 'crypto';
import { getUser, updateUser } from "./database.js";
import { analyzeProfilePhoto } from "./aiHandler.js";

// ---- هش کردن متن ----
function hashText(text) {
    return crypto.createHash('sha1').update(text || '').digest('hex');
}

// ---- گرفتن آیدی عکس ----
function getPhotoId(photo) {
    if (!photo) return '';
    const id = photo.id ?? photo.photoId;
    return id !== undefined && id !== null ? String(id) : '';
}

// ---- دریافت اطلاعات کامل کاربر و بررسی تغییرات بیو/عکس ----
export async function getUserFullInfo(client, userId, chatId) {
    try {
        const user = await getUser(userId, chatId);

        let bio = user.bio || '';
        let bioHash = user.bioHash || '';
        let photoId = user.photoId || '';
        let photoAnalysis = user.profilePhoto || '';
        let photoChanged = false;
        let bioChanged = false;

        const previousBio = bio;
        const previousBioHash = bioHash;
        const previousPhotoId = photoId;
        const previousPhotoAnalysis = photoAnalysis;

        try {
            const full = await client.api.users.getFullUser({ id: userId });
            const freshBio = (full?.fullUser?.about || '').trim();
            const freshPhoto = full?.fullUser?.profilePhoto;
            const freshPhotoId = getPhotoId(freshPhoto);

            if (freshBio) {
                const freshHash = hashText(freshBio);
                if (freshHash !== bioHash) {
                    bio = freshBio;
                    bioHash = freshHash;
                    bioChanged = true;
                    await updateUser(userId, chatId, { bio, bioHash });
                }
            }

            if (freshPhotoId && freshPhotoId !== photoId) {
                photoId = freshPhotoId;
                photoChanged = true;
                await updateUser(userId, chatId, { photoId });
            }


            if (bioChanged || photoChanged) {
                await addAnalysisHistory(userId, chatId, {
                    bio: previousBio,
                    photoAnalysis: previousPhotoAnalysis,
                    bioHash: previousBioHash,
                    photoId: previousPhotoId,
                    date: new Date()
                });
            }
        } catch (error) {
            console.error("---------- خطا در دریافت اطلاعات کاربر:", error);
        }

        return {
            ...user.toObject(),
            bio,
            photoAnalysis,
            profileChanged: photoChanged,
            bioChanged,
            previousPhotoAnalysis,
            previousBio
        };
    } catch (error) {
        console.error("------------- error to Receive data user", error);
        return null;
    }
}

// ---- تحلیل عکس پروفایل (با درخواست صریح کاربر) ----
export async function analyzeAndStoreProfile(client, userId, chatId, previousAnalysis = '') {
    try {
        const analysis = await analyzeProfilePhoto(client, userId, previousAnalysis);
        if (analysis) {
            await updateUser(userId, chatId, { profilePhoto: analysis });
        }
        return analysis;
    } catch (error) {
        console.error(" ------------error to analiz and store", error);
        return null;
    }
}

// ---- چک سقف پیام کاربر ----
export async function checkUserLimit(userId, chatId) {
    const user = await getUser(userId, chatId);
    const limit = Number(process.env.USER_LIMIT_MESSAGES) || 5;
    const hours = Number(process.env.USER_LIMIT_HOURS) || 2;

    if (user.resetTime && new Date() > user.resetTime) {
        await updateUser(userId, chatId, {
            messageCount: 0,
            resetTime: null
        });
        return true;
    }

    return user.messageCount < limit;
}

// ---- افزایش شمارنده پیام کاربر ----
export async function incrementUserMessage(userId, chatId) {
    const user = await getUser(userId, chatId);
    const hours = Number(process.env.USER_LIMIT_HOURS) || 2;
    const newCount = user.messageCount + 1;
    const resetTime = user.resetTime || new Date(Date.now() + hours * 3600 * 1000);

    await updateUser(userId, chatId, {
        messageCount: newCount,
        resetTime: resetTime,
        lastInteraction: new Date()
    });
}

// ---- ریست سقف کاربر ----
export async function resetUserLimit(userId, chatId) {
    await updateUser(userId, chatId, {
        messageCount: 0,
        resetTime: null
    });
}

// ---- ذخیره آخرین لحن ----
export async function setUserTone(userId, chatId, tone) {
    await updateUser(userId, chatId, { tone });
}

// ---- ثبت شمارنده رفتارها ----
export async function updateUserBehavior(userId, chatId, behavior) {
    const user = await getUser(userId, chatId);
    const counts = user.behaviorCounts && typeof user.behaviorCounts === 'object' ? user.behaviorCounts : {};
    counts[behavior] = (counts[behavior] || 0) + 1;
    await updateUser(userId, chatId, { behaviorCounts: counts });
}

// ---- ثبت فایل دریافتی ----
export async function addReceivedFile(userId, chatId, fileName) {
    await updateUser(userId, chatId, {
        $push: { receivedFiles: fileName }
    });
}

// ---- ثبت تاریخچه تغییرات ----
export async function addAnalysisHistory(userId, chatId, record) {
    const user = await getUser(userId, chatId);
    const history = Array.isArray(user.analysisHistory) ? user.analysisHistory : [];
    history.push(record);
    const trimmed = history.slice(-5);
    await updateUser(userId, chatId, { analysisHistory: trimmed });
}

// ---- حافظه روزانه: ذخیره آخرین پیام‌ها ----
export async function saveDailyMessageMemory(userId, chatId, message) {
    const user = await getUser(userId, chatId);
    const today = new Date().toISOString().split('T')[0]; 

    let memory = Array.isArray(user.dailyMessageMemory) ? [...user.dailyMessageMemory] : [];

    // ورودی امروز را بساز یا بگیر
    let todayEntry = memory.find((m) => m.date === today);
    if (!todayEntry) {
        todayEntry = { date: today, messages: [] };
        memory.push(todayEntry);
    }

    // فقط ۲ پیام آخر
    todayEntry.messages.push(message);
    if (todayEntry.messages.length > 2) {
        todayEntry.messages = todayEntry.messages.slice(-2);
    }

    // فقط ۳۰ روز آخر
    if (memory.length > 30) {
        memory = memory.slice(-30);
    }

    await updateUser(userId, chatId, { dailyMessageMemory: memory });
}

// ---- گرفتن پیام‌های امروز ----
export async function getDailyMessages(userId, chatId) {
    const user = await getUser(userId, chatId);
    const today = new Date().toISOString().split('T')[0];
    const entry = (user.dailyMessageMemory || []).find((m) => m.date === today);
    return entry ? entry.messages : [];
}

// ---- گرفتن کل حافظه روزانه ----
export async function getAllDailyMessages(userId, chatId) {
    const user = await getUser(userId, chatId);
    return user.dailyMessageMemory || [];
}

// ---- به‌روزرسانی پروفایل رفتاری ----
export async function updateBehaviorProfile(userId, chatId, behavior, intensity = 1) {
    const user = await getUser(userId, chatId);
    const profile = user.behaviorProfile && typeof user.behaviorProfile === 'object'
        ? { ...user.behaviorProfile }
        : {};

    // مقداردهی اولیه
    if (!profile.toneCounts) profile.toneCounts = {};
    if (!profile.toneDistribution) profile.toneDistribution = {};
    if (!profile.recentTones) profile.recentTones = [];
    if (!profile.levels) profile.levels = {
        rude: 0, polite: 0, romantic: 0, sexy: 0, sports: 0, dirtyTalk: 0, music: 0
    };
    if (!profile.flags) profile.flags = {
        excessiveRude: false, excessivePolite: false,
        excessiveRomantic: false, excessiveSexy: false
    };
    if (!profile.interests) profile.interests = [];
    if (!profile.lastProfileUpdate) profile.lastProfileUpdate = new Date();

    // افزایش شمارنده لحن
    profile.toneCounts[behavior] = (profile.toneCounts[behavior] || 0) + 1;

    // محاسبه توزیع وزنی
    const total = Object.values(profile.toneCounts).reduce((s, v) => s + v, 0) || 1;
    for (const [t, c] of Object.entries(profile.toneCounts)) {
        profile.toneDistribution[t] = Number((c / total).toFixed(3));
    }

    // ذخیره در recentTones
    const today = new Date().toISOString().split('T')[0];
    profile.recentTones.push({ date: today, tone: behavior, intensity });
    if (profile.recentTones.length > 50) profile.recentTones = profile.recentTones.slice(-50);

    // به‌روزرسانی سطوح
    const levelMap = {
        rude: 'rude', romantic: 'romantic', sexy: 'sexy', sports: 'sports',
        dirty_talk: 'dirtyTalk', music: 'music', polite: 'polite'
    };
    if (levelMap[behavior]) {
        const levelKey = levelMap[behavior];
        const count = profile.toneCounts[behavior] || 0;
        
        profile.levels[levelKey] = Math.min(count / 5, 1.0);
    }

    // تشخیص رفتارهای افراطی
    profile.flags.excessiveRude = (profile.levels.rude > 0.5 || (profile.toneCounts['rude'] || 0) > 5);
    profile.flags.excessivePolite = (profile.levels.polite > 0.3 && (profile.toneCounts['rude'] || 0) < 2);
    profile.flags.excessiveRomantic = (profile.levels.romantic > 0.4);
    profile.flags.excessiveSexy = (profile.levels.sexy > 0.4);

    profile.lastProfileUpdate = new Date();

    await updateUser(userId, chatId, { behaviorProfile: profile });
}

// ---- تطبیق شخصیت ربات با رفتار کاربر ----
export async function adaptPersonalityToBehavior(userId, chatId, behavior, profile) {
    const user = await getUser(userId, chatId);
    let adaptation = user.personalityAdaptation && user.personalityAdaptation !== null
        ? { ...user.personalityAdaptation }
        : {};

    // مقادیر پیش‌فرض
    if (!adaptation.rudeMultiplier) adaptation.rudeMultiplier = 1.0;
    if (!adaptation.romanticBoost) adaptation.romanticBoost = 1.0;
    if (!adaptation.sexyBoost) adaptation.sexyBoost = 1.0;
    if (!adaptation.kindnessBoost) adaptation.kindnessBoost = 1.0;
    if (!adaptation.sportsInterest) adaptation.sportsInterest = 0.5;
    if (!adaptation.musicInterest) adaptation.musicInterest = 0.5;
    if (!adaptation.dirtyTalkLevel) adaptation.dirtyTalkLevel = 0.3;
    if (!adaptation.politenessLevel) adaptation.politenessLevel = 0.5;
    if (!adaptation.customSections) adaptation.customSections = {};

    const levels = profile?.levels || {};

    // کاربران بی‌ادب => ربات بی‌ادب‌تر
    if (levels.rude > 0.3) {
        adaptation.rudeMultiplier = Math.min(1.0 + levels.rude, 2.5);
        adaptation.politenessLevel = Math.max(0.2, 1.0 - levels.rude);
    }

    // کاربران مودب => ربات مهربان‌تر
    if (levels.polite > 0.3) {
        adaptation.kindnessBoost = Math.min(1.0 + levels.polite, 2.0);
        adaptation.politenessLevel = Math.min(1.0, adaptation.politenessLevel + levels.polite * 0.3);
    }

    // کاربران عاشق‌پیشه => ربات عاشقانه‌تر
    if (levels.romantic > 0.2) {
        adaptation.romanticBoost = Math.min(1.0 + levels.romantic * 1.5, 3.0);
    }

    // کاربران سکسی => ربات سکسی‌تر
    if (levels.sexy > 0.2) {
        adaptation.sexyBoost = Math.min(1.0 + levels.sexy * 1.5, 3.0);
        adaptation.dirtyTalkLevel = Math.min(1.0, adaptation.dirtyTalkLevel + levels.sexy * 0.4);
    }

    // علاقه به ورزش و موسیقی
    adaptation.sportsInterest = Math.min(1.0, (levels.sports || 0) + 0.2);
    adaptation.musicInterest = Math.min(1.0, (levels.music || 0) + 0.2);
    adaptation.dirtyTalkLevel = Math.min(1.0, adaptation.dirtyTalkLevel + (levels.dirtyTalk || 0));

    adaptation.lastAdaptation = new Date();

    await updateUser(userId, chatId, { personalityAdaptation: adaptation });
    return adaptation;
}

// ---- استخراج کلمات کلیدی و علایق ----
export async function extractUserInterests(userId, chatId, text) {
    if (!text || !text.trim()) return;
    const user = await getUser(userId, chatId);
    const profile = user.behaviorProfile && user.behaviorProfile !== null
        ? { ...user.behaviorProfile }
        : {};

    if (!profile.interests) profile.interests = [];

    // استخراج ساده کلمات: کلمات با طول >= ۳ بدون تکرار
    const words = text.toLowerCase().match(/[\u0600-\u06FF\s]+/g)?.[0]
        ? text.match(/[\u0600-\u06FF]{3,}/g) || []
        : text.match(/[a-zA-Z]{3,}/g) || [];

    const existing = new Set(profile.interests.map((i) => i.toLowerCase()));
    for (const w of words) {
        if (!existing.has(w.toLowerCase())) {
            profile.interests.push(w);
            existing.add(w.toLowerCase());
        }
    }

    // حداکثر ۵۰ کلمه
    if (profile.interests.length > 50) {
        profile.interests = profile.interests.slice(-50);
    }

    profile.lastProfileUpdate = new Date();

    await updateUser(userId, chatId, { behaviorProfile: profile });
}

// ---- آخرین پیام کاربر برای کانتکست ----
export async function getLastMessage(userId, chatId) {
    const user = await getUser(userId, chatId);
    const msgs = Array.isArray(user.last24hMessages) ? user.last24hMessages : [];
    return msgs.length > 0 ? msgs[msgs.length - 1] : '';
}

// ---- ذخیره پیام در آرشیو ۲۴ ساعته ----
export async function saveRecentMessage(userId, chatId, message) {
    const user = await getUser(userId, chatId);
    let msgs = Array.isArray(user.last24hMessages) ? [...user.last24hMessages] : [];
    msgs.push(message);
    if (msgs.length > 10) msgs = msgs.slice(-10);
    await updateUser(userId, chatId, { last24hMessages: msgs });
}
