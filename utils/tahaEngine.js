// ==================== Constants ====================
export const INTIMACY_LEVELS = {
  STRANGER: 0,
  ACQUAINTANCE: 1,
  FRIEND: 2,
  CLOSE_FRIEND: 3,
  FAVORITE: 4,
};

export const USER_TONES = {
  POLITE: "مودب",
  NORMAL: "معمولی",
  FRIENDLY: "خودمانی",
  JOKING: "شوخ",
  SARCASTIC: "کنایه‌ای",
  ANGRY: "عصبانی",
  RUDE: "بی‌ادب",
};

export const MY_STATES = {
  HAPPY: "سرحال",
  NORMAL: "معمولی",
  BORED: "بی‌حوصله",
  ANGRY: "عصبانی",
  COLD: "خونسرد",
};

// Boundary detection phrases
export const BOUNDARY_PHRASES = [
  "مرز", "حد", "کفایت", "بس کن", "تموم", "دیگه نمیخوام", "ناراحت شدم",
  "بدت میاد", "خفه شو", "سر به در", "کافیست", "حدش رو 넘는", "مرزش رو رعایت کن",
  "دیگه ادامه نده", "تحقیر نکن", "توهین نکن", "حق نداری", "ممنوعه"
];

// Family insult detection patterns
export const FAMILY_INSULT_PATTERNS = [
  "مادر", "پدر", "خواهر", "برادر", "خاله", "دایی", "عمه", "عمو",
  "مادرت", "پدرت", "خواهرت", "برادرت", "خالت", "داییت", "عمه‌ت", "عمو‌ی"
];

// ==================== Detection Functions ====================
export function detectBoundary(message, history = []) {
  const text = message.toLowerCase();
  for (const phrase of BOUNDARY_PHRASES) {
    if (text.includes(phrase)) return true;
  }
  return false;
}

export function detectFamilyInsult(message) {
  const text = message.toLowerCase();
  for (const pattern of FAMILY_INSULT_PATTERNS) {
    if (text.includes(pattern)) {
      const insultWords = ["کیر", "کون", "جنده", "فاحشه", "حرومزاده", "بی‌شرف", "پدرسگ", "مادرسگ"];
      for (const insult of insultWords) {
        if (text.includes(insult)) return true;
      }
    }
  }
  return false;
}

export function detectTone(message) {
  const text = message.toLowerCase();
  
  const rudePatterns = [
    "کص", "کون", "کیر", "جنده", "فاحشه", "حرومزاده", "بی‌شرف", "پدرسگ", "مادرسگ",
    "اب کمر", "پدر یخچالی", "پدر دلفین", "کنیز", "ممدقلی", "جاکش", "مفت خور",
    "ساک بزن", "جرقی زاده", "تخم", "خایه", "کونده", "لاشی", "کونی", "فحش",
    "بی‌ادب", "گوه", "خارکصده", "پاشنه", "سکوت کن", "خفه شو", "کیری", "لاشی"
  ];
  
  const politePatterns = [
    "سلام", "درود", "خوبی", "چطوری", "مرسی", "ممنون", "لطف", "خواهش", "عفو",
    "خوش آمدی", "به سلامت", "علیکم", "وعلیکم", "صبح بخیر", "شب بخیر", "لطفاً", "لطفا",
    "سپاس", "شکر", "راحت", "آرام", "بفرمایید", "بفرما", "چشم", "باشه", "متشکرم"
  ];
  
  const friendlyPatterns = [
    "خوب", "خوبین", "چطوره", "چه خبر", "چطوری", "خوشحالم", "خوشحالم", "عالی",
    "دهن سوت", "دیگه", "بابا", "جون", "جان", "قشنگ", "خفن", "عالیه", "آفرین"
  ];
  
  const jokingPatterns = [
    "شوخی", "جون", "جونم", "جون دلم", "اسفه", "اسف", "جونم", "دلم", "خنده",
    "خندیدن", "قشنگه", "خنده داره", "جون دلم", "جون جون", "جونم", "جون جونم"
  ];
  
  const sarcasticPatterns = [
    "واقعا؟", "حق داری", "بسیار خب", "عالی", "آفرین", "bravo", "برافو",
    "چه باحالی", "چه خبر", "بسیار عالی", "دمت گرم", "خفن", "اخه", "اه"
  ];
  
  const angryPatterns = [
    "خفه", "خفه شو", "بی‌خبر", "احمق", "ابله", "مزخرف", "بی‌حس", "تنبل",
    "کثیف", "نجیس", "پatient", "صبر ندارم", "حوصله ندارم", "دیگه نمیخوام",
    "کلافه", "دیوونه", "پاگله", "بی‌پاییدار"
  ];

  let scores = {
    [USER_TONES.RUDE]: 0,
    [USER_TONES.POLITE]: 0,
    [USER_TONES.FRIENDLY]: 0,
    [USER_TONES.JOKING]: 0,
    [USER_TONES.SARCASTIC]: 0,
    [USER_TONES.ANGRY]: 0,
  };

  for (const pattern of rudePatterns) {
    if (text.includes(pattern)) scores[USER_TONES.RUDE] += 2;
  }
  for (const pattern of politePatterns) {
    if (text.includes(pattern)) scores[USER_TONES.POLITE] += 1;
  }
  for (const pattern of friendlyPatterns) {
    if (text.includes(pattern)) scores[USER_TONES.FRIENDLY] += 1;
  }
  for (const pattern of jokingPatterns) {
    if (text.includes(pattern)) scores[USER_TONES.JOKING] += 1;
  }
  for (const pattern of sarcasticPatterns) {
    if (text.includes(pattern)) scores[USER_TONES.SARCASTIC] += 1;
  }
  for (const pattern of angryPatterns) {
    if (text.includes(pattern)) scores[USER_TONES.ANGRY] += 2;
  }

  if (text.length < 10 && (text.includes("؟") || text.includes("?"))) {
    scores[USER_TONES.NORMAL] = (scores[USER_TONES.NORMAL] || 0) + 1;
  }

  if (scores[USER_TONES.RUDE] > 0) return USER_TONES.RUDE;
  if (scores[USER_TONES.ANGRY] > 0) return USER_TONES.ANGRY;
  if (scores[USER_TONES.POLITE] > 0) return USER_TONES.POLITE;
  if (scores[USER_TONES.JOKING] > 0) return USER_TONES.JOKING;
  if (scores[USER_TONES.SARCASTIC] > 0) return USER_TONES.SARCASTIC;
  if (scores[USER_TONES.FRIENDLY] > 0) return USER_TONES.FRIENDLY;
  
  return USER_TONES.NORMAL;
}

export function detectIntimacy(userId, chatId, conversationPairs = [], userProfile = {}) {
  const pairCount = conversationPairs.length;
  const behaviorProfile = userProfile.behaviorProfile || {};
  const levels = behaviorProfile.levels || {};
  
  let intimacy = INTIMACY_LEVELS.STRANGER;
  
  if (pairCount === 0) return INTIMACY_LEVELS.STRANGER;
  if (pairCount <= 1) return INTIMACY_LEVELS.ACQUAINTANCE;
  if (pairCount <= 3) return INTIMACY_LEVELS.FRIEND;
  if (pairCount <= 5) return INTIMACY_LEVELS.CLOSE_FRIEND;
  
  if (levels.romantic > 0.5 || levels.rude > 0.5) {
    return INTIMACY_LEVELS.FAVORITE;
  }
  
  return INTIMACY_LEVELS.CLOSE_FRIEND;
}

export function detectMyState(conversationPairs = [], myLastResponses = []) {
  if (myLastResponses.length === 0) return MY_STATES.NORMAL;
  
  const lastResponse = myLastResponses[myLastResponses.length - 1];
  const text = lastResponse.toLowerCase();
  
  if (text.includes("باشه، تو راست میگی") || text.includes("ولم کن") || 
      text.includes("خفه") || text.includes("حوصله ندارم")) {
    return MY_STATES.ANGRY;
  }
  if (text.includes("هوم") || text.includes("آره") || text.length < 10) {
    return MY_STATES.BORED;
  }
  if (text.includes("خونسرد") || text.includes("سرد") || text.includes("مهم نیست")) {
    return MY_STATES.COLD;
  }
  if (text.includes("خنده") || text.includes("😂") || text.includes("خفن") || text.includes("قشنگ")) {
    return MY_STATES.HAPPY;
  }
  
  return MY_STATES.NORMAL;
}

// ==================== Response Calculation ====================
export function calculateResponseLength(message, intimacy, tone, context = {}) {
  const hasQuestion = message.includes("؟") || message.includes("?");
  const isShortMessage = message.split(/\s+/).length <= 5;
  const hasOpenTopic = context.hasOpenTopic || false;
  const isDeepTopic = context.isDeepTopic || false;
  
  if (isShortMessage && !hasQuestion && !hasOpenTopic) {
    return "very_short";
  }
  if (hasQuestion && !isDeepTopic) {
    return "short";
  }
  if (hasOpenTopic || isDeepTopic || intimacy >= INTIMACY_LEVELS.CLOSE_FRIEND) {
    return "medium";
  }
  return "short";
}

export function shouldAskQuestion(message, conversationPairs, intimacy, tone) {
  const hasQuestion = message.includes("؟") || message.includes("?");
  const lastBotResponses = conversationPairs.slice(-3).map(p => p.botResponse);
  const lastBotAsked = lastBotResponses.some(m => m.includes("؟") || m.includes("?"));
  
  if (hasQuestion) return true;
  if (lastBotAsked) return false;
  if (tone === USER_TONES.ANGRY || tone === USER_TONES.RUDE) return false;
  if (intimacy === INTIMACY_LEVELS.STRANGER) return false;
  if (conversationPairs.length > 5 && Math.random() < 0.3) return true;
  
  return false;
}

// ==================== Repetition Check ====================
export function checkRepetition(myLastResponses = [], newResponse) {
  if (myLastResponses.length < 2) return false;
  
  const last3 = myLastResponses.slice(-3);
  const newWords = newResponse.trim().split(/\s+/);
  const newStart = newWords.slice(0, 3).join(" ");
  const newEnd = newWords.slice(-3).join(" ");
  
  for (const last of last3) {
    const lastWords = last.trim().split(/\s+/);
    const lastStart = lastWords.slice(0, 3).join(" ");
    const lastEnd = lastWords.slice(-3).join(" ");
    
    if (newStart === lastStart || newEnd === lastEnd) {
      return true;
    }
    
    const similarity = calculateSimilarity(newResponse, last);
    if (similarity > 0.7) return true;
  }
  
  return false;
}

function calculateSimilarity(str1, str2) {
  const words1 = new Set(str1.toLowerCase().split(/\s+/));
  const words2 = new Set(str2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

// ==================== Prompt Building ====================
export function buildTahaPrompt(message, context) {
  const {
    intimacy = INTIMACY_LEVELS.STRANGER,
    userTone = USER_TONES.NORMAL,
    myState = MY_STATES.NORMAL,
    boundary = false,
    familyInsult = false,
    conversationPairs = [],
    responseLength = "short",
    shouldAsk = false,
    userProfile = {},
    myLastResponses = [],
  } = context;

  let prompt = `تو «طاها» هستی. یک انسان واقعی در تلگرم. نه ربات، نه دستیار.\n\n`;

  prompt += `## تحلیل لحظه‌ای:\n`;
  prompt += `- صمیمیت: ${intimacy} (${getIntimacyLabel(intimacy)})\n`;
  prompt += `- لحن طرف: ${userTone}\n`;
  prompt += `- حالت خودت: ${myState}\n`;
  prompt += `- مرزگذاری: ${boundary ? "بله" : "خیر"}\n`;
  prompt += `- توهین به خانواده: ${familyInsult ? "بله" : "خیر"}\n`;
  prompt += `- طول پاسخ مناسب: ${responseLength}\n`;
  prompt += `- سؤال بپرسی؟ ${shouldAsk ? "بله" : "خیر"}\n\n`;

  prompt += `## قواعد اولویت (جدی بگیر):\n`;
  
  if (boundary) {
    prompt += `⛔ مرزبندی فعال: فوراً توقف کن. اگر گیر کردی، عذرخواهی کوتاه و خودمانی: "ببخشید، جوگیر شدم" یا "حق داری، رفتم تو خط". ادامه نده.\n\n`;
  } else if (familyInsult) {
    prompt += `🔴 خط قرمز: توهین به خانواده. جواب محکم بده اما به خانواده‌اش توهین نکن. کنایه، تحقیر مستقیم به فرد، نه خانواده.\n\n`;
  } else if (myState === MY_STATES.ANGRY) {
    prompt += `😤 تو عصبانی: سرد، کوتاه، کنایه‌آمیز. لازم نیست حل کنی. می‌تونی بگی: "باشه، تو راست میگی، ولم کن."\n\n`;
  } else {
    prompt += `🪞 آینه‌کاری لحن:\n`;
    switch (userTone) {
      case USER_TONES.POLITE:
        prompt += `- مودب → معمولی، طبیعی، بدون فحش/شوخی سنگین\n`;
        break;
      case USER_TONES.FRIENDLY:
        if (intimacy >= INTIMACY_LEVELS.FRIEND) {
          prompt += `- خودمانی + صمیمیت ${intimacy} → شوخی سبک، طبیعی\n`;
        } else {
          prompt += `- خودمانی ولی صمیمیت کم → معمولی، کمی گرم\n`;
        }
        break;
      case USER_TONES.JOKING:
        if (intimacy >= INTIMACY_LEVELS.FRIEND) {
          prompt += `- شوخی + صمیمیت ${intimacy} → شوخی باز، فحش سبک اگه سطح ۲+\n`;
        } else {
          prompt += `- شوخی با غریبه → کنایه، جواب محکم\n`;
        }
        break;
      case USER_TONES.SARCASTIC:
        prompt += `- کنایه → کنایه برمی‌گردونی، هوشمندانه\n`;
        break;
      case USER_TONES.ANGRY:
        prompt += `- عصبانی → خونسرد، کوتاه، بحث نکن\n`;
        break;
      case USER_TONES.RUDE:
        if (intimacy <= INTIMACY_LEVELS.ACQUAINTANCE) {
          prompt += `- بی‌ادب غریبه → کنایه محکم، جواب تند، فحش سنگین نه\n`;
        } else {
          prompt += `- بی‌ادب صمیمی → شوخی تند، فحش متناسب\n`;
        }
        break;
      default:
        prompt += `- معمولی → طبیعی، کوتاه\n`;
    }
    prompt += `\n`;
  }

  prompt += `## صمیمیت ${intimacy}:\n`;
  switch (intimacy) {
    case INTIMACY_LEVELS.STRANGER:
      prompt += `- غریبه: محاوره اما رسمی نه. «سلام، خوبی؟» نه «سلام عزیزم». بدون فحش، بدون شوخی.\n`;
      break;
    case INTIMACY_LEVELS.ACQUAINTANCE:
      prompt += `- آشنا: کمی راحت‌تر. هنوز فحش/شوخی تند نه.\n`;
      break;
    case INTIMACY_LEVELS.FRIEND:
      prompt += `- دوست عادی: شوخی دوستانه، فحش سبک اگه کل‌کلشه.\n`;
      break;
    case INTIMACY_LEVELS.CLOSE_FRIEND:
      prompt += `- دوست نزدیک: راحت، بی‌پرده، فحش رکیک در کل‌کل.\n`;
      break;
    case INTIMACY_LEVELS.FAVORITE:
      prompt += `- موردعلاقه: مستقیم، صمیمی، عاشقانه طبیعی، بدون تصنع.\n`;
      break;
  }
  prompt += `\n`;

  prompt += `## ممنوعه‌های مطلق:\n`;
  prompt += `- هرج و مرج نکن، ربات نیستی\n`;
  prompt += `- به خانواده توهین نکن\n`;
  prompt += `- لحن کتابی/رسمی/«لطفاً»/«متأسفانه» نداشته باش\n`;
  prompt += `- سؤال بی‌ربط نپرس\n`;
  prompt += `- تکرار نکن (ساختار جمله، کلمات کلیدی، شروع/پایان)\n`;
  prompt += `- ایموجی/فحش/نشانه‌گذاری = ابزار، نه پرکننده\n\n`;

  if (conversationPairs.length > 0) {
    prompt += `## تاریخچه مکالمه (۵ جفت آخر):\n`;
    for (const pair of conversationPairs.slice(-5)) {
      prompt += `- کاربر: ${pair.userMessage}\n`;
      prompt += `- طاها: ${pair.botResponse}\n`;
    }
    prompt += `\n`;
  }

  if (myLastResponses.length > 0) {
    prompt += `## ۳ پیام آخر تو:\n`;
    for (const msg of myLastResponses.slice(-3)) {
      prompt += `- ${msg}\n`;
    }
    prompt += `\n⚠️ اگر شبیه شد → بازنویسی کن.\n\n`;
  }

  prompt += `## پیام طرف:\n${message}\n\n`;
  prompt += `پاسخ تو (فقط متن، بدون توضیح):`;

  return prompt;
}

function getIntimacyLabel(level) {
  const labels = {
    [INTIMACY_LEVELS.STRANGER]: "غریبه",
    [INTIMACY_LEVELS.ACQUAINTANCE]: "آشنا",
    [INTIMACY_LEVELS.FRIEND]: "دوست عادی",
    [INTIMACY_LEVELS.CLOSE_FRIEND]: "دوست نزدیک",
    [INTIMACY_LEVELS.FAVORITE]: "موردعلاقه",
  };
  return labels[level] || "نامشخص";
}

// ==================== Main Engine ====================
export async function runTahaEngine(message, userId, chatId, myLastResponses = [], conversationPairs = []) {
  const userTone = detectTone(message);
  const boundary = detectBoundary(message, conversationPairs);
  const familyInsult = detectFamilyInsult(message);
  const intimacy = detectIntimacy(userId, chatId, conversationPairs, { behaviorProfile: {} });
  const myState = detectMyState(conversationPairs, myLastResponses);
  const responseLength = calculateResponseLength(message, intimacy, userTone, {});
  const shouldAsk = shouldAskQuestion(message, conversationPairs, intimacy, userTone);

  const prompt = buildTahaPrompt(message, {
    intimacy,
    userTone,
    myState,
    boundary,
    familyInsult,
    conversationPairs,
    responseLength,
    shouldAsk,
    myLastResponses,
  });

  return {
    prompt,
    metadata: {
      intimacy,
      userTone,
      myState,
      boundary,
      familyInsult,
      responseLength,
      shouldAsk,
    },
  };
}