import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSystemStatus, updateSystemStatus } from "./database.js";
import { getDictionaryResponse } from "./dictionaryHandler.js";
import { DEFAULT_PERSONALITY } from "../personality.js";
import { getConversationPairs } from "./userManager.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  runTahaEngine,
  INTIMACY_LEVELS,
  USER_TONES,
  MY_STATES,
} from "./tahaEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.AI_API_KEY;
const modelName = process.env.AI_MODEL || "gemini-flash-latest";

if (!apiKey) {
  console.error(" AI_API_KEY is empty");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
console.log(" Gemini AI running successfully");

// ==================== Response Cache ====================
const myLastResponsesCache = new Map();

function getMyLastResponses(userId, chatId) {
  const key = `${userId}:${chatId}`;
  return myLastResponsesCache.get(key) || [];
}

function addMyResponse(userId, chatId, response) {
  const key = `${userId}:${chatId}`;
  const arr = myLastResponsesCache.get(key) || [];
  arr.push(response);
  if (arr.length > 10) arr.shift();
  myLastResponsesCache.set(key, arr);
}

// ==================== AI Response Generation ====================
export async function getAIResponse(userMessage, userContext = {}) {
  try {
    const status = await getSystemStatus();

    if (status.geminiQuotaExceeded || status.dictionaryMode) {
      console.log("⚠️ limiting API_KEY");
      return null;
    }

    const model = genAI.getGenerativeModel({ model: modelName });

    const userId = userContext.userId;
    const chatId = userContext.chatId;
    
    const myLastResponses = getMyLastResponses(userId, chatId);
    
    // Get last 5 conversation pairs for long-term memory
    let conversationPairs = [];
    if (userId && chatId) {
      conversationPairs = await getConversationPairs(userId, chatId);
    }

    const engineResult = await runTahaEngine(userMessage, userId, chatId, myLastResponses, conversationPairs);
    const { prompt, metadata } = engineResult;

    console.log(`🧠 Taha Engine: intimacy=${metadata.intimacy}, tone=${metadata.userTone}, state=${metadata.myState}, boundary=${metadata.boundary}, familyInsult=${metadata.familyInsult}`);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponse = response.text().trim();

    if (aiResponse) {
      addMyResponse(userId, chatId, aiResponse);
    }

    return aiResponse;
  } catch (error) {
    console.error(" error for Gemini:", error);

    const errMsg = error.message || String(error);
    if (
      errMsg.includes("quota") ||
      errMsg.includes("limit") ||
      errMsg.includes("429")
    ) {
      await updateSystemStatus({
        geminiQuotaExceeded: true,
        dictionaryMode: true,
      });
      console.log("⚠️ limit is full connected to dictionary");
    } else if (
      errMsg.includes("403") ||
      errMsg.includes("API_KEY_INVALID") ||
      errMsg.includes("API key not valid") ||
      errMsg.includes("Permission denied")
    ) {
      await updateSystemStatus({ dictionaryMode: true });
      console.log("⚠️ AI_API_KEY is invalid (403). dictionary mode ON - fix the key and restart to recover");
    }
    return null;
  }
}

// ==================== Profile Photo Analysis ====================
export async function analyzeProfilePhoto(
  client,
  userId,
  profilePhoto = null,
  previousAnalysis = "",
) {
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
      outputFile: `/tmp/profile_${userId}.jpg`,
    });
    if (!file) return null;

    const imageBuffer =
      typeof file === "string"
        ? fs.readFileSync(file)
        : Buffer.isBuffer(file)
          ? file
          : Buffer.from(file);
    const model = genAI.getGenerativeModel({ model: modelName });
    const image = {
      inlineData: {
        data: imageBuffer.toString("base64"),
        mimeType: "image/jpeg",
      },
    };

    let visionPrompt =
      "You are a precise profile photo analyzer. Analyze user's profile photo in detail: " +
      "Hair color/style, eye color, makeup (if any), clothing color/type, dress style, background, eye state, smile/expression, overall style, accessories, lighting, mood. " +
      "Also note hidden details (pets, locations, identifiable objects). " +
      "Only mention actually visible details, no generic assumptions. Output in Persian, 4-6 sentences.";

    if (previousAnalysis) {
      visionPrompt +=
        `\nPrevious profile photo analysis for this user: ${previousAnalysis}\n` +
        "Compare new photo with previous analysis and list appearance changes (hair color, glasses, style, clothing, etc.) separately.";
    }

    const result = await model.generateContent([visionPrompt, image]);
    const analysis = await result.response.text();
    if (typeof file === "string") {
      try {
        fs.unlinkSync(file);
      } catch (e) {}
    }
    return analysis;
  } catch (error) {
    console.error("❌ error to analiz", error);
    return null;
  }
}

// ==================== Connection Management ====================
export async function testGeminiConnection() {
  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    await model.generateContent("Test");
    console.log(`✅ Gemini connection OK (model: ${modelName})`);
    await updateSystemStatus({ geminiQuotaExceeded: false, dictionaryMode: false });
    return true;
  } catch (error) {
    console.log(`❌ Gemini connection FAILED (${modelName}): ${(error.message || String(error)).slice(0, 150)}`);
    console.log("⚠️ AI_API_KEY seems invalid. Bot runs in dictionary mode until key is fixed and bot is restarted.");
    await updateSystemStatus({ dictionaryMode: true });
    return false;
  }
}

export async function checkAndRecoverGemini() {
  try {
    const status = await getSystemStatus();
    if (!status.geminiQuotaExceeded && !status.dictionaryMode) return;

    const model = genAI.getGenerativeModel({ model: modelName });
    await model.generateContent("Test");

    await updateSystemStatus({
      geminiQuotaExceeded: false,
      dictionaryMode: false,
    });
    console.log("....  ✅ AI is oky , dictionary is OFF  ....");
  } catch (error) {
    console.log("....  ⏳ AI is OFF dictionary is ON  ....");
  }
}