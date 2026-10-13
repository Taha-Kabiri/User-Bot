import crypto from 'crypto';
import { getUser, updateUser } from "./database.js";
import { analyzeProfilePhoto } from "./aiHandler.js";

function hashText(text) {
    return crypto.createHash('sha1').update(text || '').digest('hex');
}

function getPhotoId(photo) {
    if (!photo) return '';
    const id = photo.id ?? photo.photoId;
    return id !== undefined && id !== null ? String(id) : '';
}

// ==================== User Info ====================
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

            if (photoChanged || !photoAnalysis) {
                photoAnalysis = await analyzeProfilePhoto(client, userId, freshPhoto, photoChanged ? previousPhotoAnalysis : '') || '';
                if (photoAnalysis) {
                    await updateUser(userId, chatId, { profilePhoto: photoAnalysis });
                }
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
            console.error("❌ خطا در دریافت اطلاعات کاربر:", error);
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
        console.error(" error to Receive data user", error);
        return null;
    }
}

// ==================== User Limits ====================
// Check per-user message limit
export async function checkUserLimit(userId, chatId) {
    const user = await getUser(userId, chatId);
    const limit = Number(process.env.USER_LIMIT_MESSAGES) || 30;
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

// Increment user message counter
export async function incrementUserMessage(userId, chatId) {
    const user = await getUser(userId, chatId);
    const hours = Number(process.env.USER_LIMIT_HOURS) || 2;
    const resetTime = user.resetTime || new Date(Date.now() + hours * 3600 * 1000);

    await updateUser(userId, chatId, {
        $inc: { messageCount: 1 },
        $set: { resetTime: resetTime, lastInteraction: new Date() }
    });
}

export async function resetUserLimit(userId, chatId) {
    await updateUser(userId, chatId, {
        messageCount: 0,
        resetTime: null
    });
}

// ==================== Tone & Behavior Tracking ====================
// Store detected user tone
export async function setUserTone(userId, chatId, tone) {
    await updateUser(userId, chatId, { tone });
}

// Track user behavior patterns
export async function updateUserBehavior(userId, chatId, behavior) {
    const user = await getUser(userId, chatId);
    const counts = user.behaviorCounts && typeof user.behaviorCounts === 'object' ? user.behaviorCounts : {};
    counts[behavior] = (counts[behavior] || 0) + 1;
    await updateUser(userId, chatId, { behaviorCounts: counts });
}

export async function addReceivedFile(userId, chatId, fileName) {
    await updateUser(userId, chatId, {
        $push: { receivedFiles: fileName }
    });
}

export async function addAnalysisHistory(userId, chatId, record) {
    const user = await getUser(userId, chatId);
    const history = Array.isArray(user.analysisHistory) ? user.analysisHistory : [];
    history.push(record);
    const trimmed = history.slice(-5);
    await updateUser(userId, chatId, { analysisHistory: trimmed });
}

// ==================== Daily Memory ====================
// Daily memory: store last 2 messages per user per day
export async function saveDailyMessageMemory(userId, chatId, message) {
    const user = await getUser(userId, chatId);
    const today = new Date().toISOString().split('T')[0]; 

    let memory = Array.isArray(user.dailyMessageMemory) ? [...user.dailyMessageMemory] : [];

    let todayEntry = memory.find((m) => m.date === today);
    if (!todayEntry) {
        todayEntry = { date: today, messages: [] };
        memory.push(todayEntry);
    }

    todayEntry.messages.push(message);
    if (todayEntry.messages.length > 2) {
        todayEntry.messages = todayEntry.messages.slice(-2);
    }

    if (memory.length > 30) {
        memory = memory.slice(-30);
    }

    await updateUser(userId, chatId, { dailyMessageMemory: memory });
}

// Get today's last 2 messages
export async function getDailyMessages(userId, chatId) {
    const user = await getUser(userId, chatId);
    const today = new Date().toISOString().split('T')[0];
    const entry = (user.dailyMessageMemory || []).find((m) => m.date === today);
    return entry ? entry.messages : [];
}

// Get all daily memory
export async function getAllDailyMessages(userId, chatId) {
    const user = await getUser(userId, chatId);
    return user.dailyMessageMemory || [];
}

// ==================== Conversation History ====================
// Get conversation pairs (user message + bot response) - last 5
export async function getConversationPairs(userId, chatId) {
    const user = await getUser(userId, chatId);
    const pairs = Array.isArray(user.conversationPairs) ? user.conversationPairs : [];
    return pairs.slice(-5);
}

// Save conversation pair
export async function saveConversationPair(userId, chatId, userMessage, botResponse) {
    if (!userMessage || !userMessage.trim() || !botResponse || !botResponse.trim()) {
        return;
    }

    const user = await getUser(userId, chatId);
    const pairs = Array.isArray(user.conversationPairs) ? [...user.conversationPairs] : [];

    pairs.push({
        userMessage: userMessage.trim(),
        botResponse: botResponse.trim(),
        timestamp: new Date()
    });

    const trimmedPairs = pairs.slice(-5);

    await updateUser(userId, chatId, {
        conversationPairs: trimmedPairs
    });
}

// ==================== Behavior Profile ====================
// Update user behavior profile with tone and intensity
export async function updateBehaviorProfile(userId, chatId, behavior, intensity = 1) {
    const user = await getUser(userId, chatId);
    const profile = user.behaviorProfile && typeof user.behaviorProfile === 'object'
        ? { ...user.behaviorProfile }
        : {};

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

    profile.toneCounts[behavior] = (profile.toneCounts[behavior] || 0) + 1;

    const total = Object.values(profile.toneCounts).reduce((s, v) => s + v, 0) || 1;
    for (const [t, c] of Object.entries(profile.toneCounts)) {
        profile.toneDistribution[t] = Number((c / total).toFixed(3));
    }

    const today = new Date().toISOString().split('T')[0];
    profile.recentTones.push({ date: today, tone: behavior, intensity });
    if (profile.recentTones.length > 50) profile.recentTones = profile.recentTones.slice(-50);

    const levelMap = {
        rude: 'rude', romantic: 'romantic', sexy: 'sexy', sports: 'sports',
        dirty_talk: 'dirtyTalk', music: 'music', polite: 'polite'
    };
    if (levelMap[behavior]) {
        const levelKey = levelMap[behavior];
        const count = profile.toneCounts[behavior] || 0;
        profile.levels[levelKey] = Math.min(count / 5, 1.0);
    }

    profile.flags.excessiveRude = (profile.levels.rude > 0.5 || (profile.toneCounts['rude'] || 0) > 5);
    profile.flags.excessivePolite = (profile.levels.polite > 0.3 && (profile.toneCounts['rude'] || 0) < 2);
    profile.flags.excessiveRomantic = (profile.levels.romantic > 0.4);
    profile.flags.excessiveSexy = (profile.levels.sexy > 0.4);

    profile.lastProfileUpdate = new Date();

    await updateUser(userId, chatId, { behaviorProfile: profile });
}

// ==================== Personality Adaptation ====================
// Adapt bot personality to user behavior
export async function adaptPersonalityToBehavior(userId, chatId, behavior, profile) {
    const user = await getUser(userId, chatId);
    let adaptation = user.personalityAdaptation && user.personalityAdaptation !== null
        ? { ...user.personalityAdaptation }
        : {};

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

    if (levels.rude > 0.3) {
        adaptation.rudeMultiplier = Math.min(1.0 + levels.rude, 2.5);
        adaptation.politenessLevel = Math.max(0.2, 1.0 - levels.rude);
    }

    if (levels.polite > 0.3) {
        adaptation.kindnessBoost = Math.min(1.0 + levels.polite, 2.0);
        adaptation.politenessLevel = Math.min(1.0, adaptation.politenessLevel + levels.polite * 0.3);
    }

    if (levels.romantic > 0.2) {
        adaptation.romanticBoost = Math.min(1.0 + levels.romantic * 1.5, 3.0);
    }

    if (levels.sexy > 0.2) {
        adaptation.sexyBoost = Math.min(1.0 + levels.sexy * 1.5, 3.0);
        adaptation.dirtyTalkLevel = Math.min(1.0, adaptation.dirtyTalkLevel + levels.sexy * 0.4);
    }

    adaptation.sportsInterest = Math.min(1.0, (levels.sports || 0) + 0.2);
    adaptation.musicInterest = Math.min(1.0, (levels.music || 0) + 0.2);
    adaptation.dirtyTalkLevel = Math.min(1.0, adaptation.dirtyTalkLevel + (levels.dirtyTalk || 0));

    adaptation.lastAdaptation = new Date();

    await updateUser(userId, chatId, { personalityAdaptation: adaptation });
    return adaptation;
}

// ==================== Interest Extraction ====================
// Extract user interests/keywords from message
export async function extractUserInterests(userId, chatId, text) {
    if (!text || !text.trim()) return;
    const user = await getUser(userId, chatId);
    const profile = user.behaviorProfile && user.behaviorProfile !== null
        ? { ...user.behaviorProfile }
        : {};

    if (!profile.interests) profile.interests = [];

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

    if (profile.interests.length > 50) {
        profile.interests = profile.interests.slice(-50);
    }

    profile.lastProfileUpdate = new Date();

    await updateUser(userId, chatId, { behaviorProfile: profile });
}

// ==================== Recent Messages ====================
// Get last user message for context
export async function getLastMessage(userId, chatId) {
    const user = await getUser(userId, chatId);
    const msgs = Array.isArray(user.last24hMessages) ? user.last24hMessages : [];
    return msgs.length > 0 ? msgs[msgs.length - 1] : '';
}

// Store message in 24h archive (max 10)
export async function saveRecentMessage(userId, chatId, message) {
    const user = await getUser(userId, chatId);
    let msgs = Array.isArray(user.last24hMessages) ? [...user.last24hMessages] : [];
    msgs.push(message);
    if (msgs.length > 10) msgs = msgs.slice(-10);
    await updateUser(userId, chatId, { last24hMessages: msgs });
}