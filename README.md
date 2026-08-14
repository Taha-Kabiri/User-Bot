# راهنمای کامل راه‌اندازی دستیار شخصی تلگرام

این پروژه یک ربات شخصی تلگرام است که قابلیت‌های زیر را ارائه می‌دهد:
* این ربات وقتی شما افلاین هستید کسی به شما در پیوی یا گروه پیام دهد به انها پاسخ مناسب داده است . با هر فرد مطابق شخصیت و لحن ان کاربر صحبت میکند .
* این ربات وقتی کاربر مودب باشد مودب پاسخ میدهد و اگر بی ادبی کند ربات هم بی ادبی میکند و قادر به استفاده از الفاظ رکیک هست .
* تشخیص لحن کاربر
* پاسخ‌گویی با Google Gemini
* مدیریت حافظه کاربران
* شخصیت تطبیقی
* محدودیت پیام روزانه و کاربری
* پشتیبانی از MongoDB
* پاسخ‌های پیش‌فرض از طریق Dictionary
* ارسال موسیقی از کانال مشخص
* خاموشی موقت توسط مالک
* به‌روزرسانی خودکار شخصیت و Dictionary
* مدیریت Session تلگرام

---

## پیش‌نیازها

قبل از اجرای پروژه موارد زیر را نصب و آماده کنید:

* اکانت فعال Telegram
* Node.js نسخه `18+`
* npm
* اینترنت پایدار
* Google AI Studio برای استفاده از Gemini — اختیاری
* MongoDB Atlas برای حافظه دائمی — اختیاری

---

## 1. دریافت Telegram API ID و API Hash

برای اتصال پروژه به Telegram به دو مقدار زیر نیاز دارید:

```env
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
```

### مراحل

1. وارد [my.telegram.org](https://my.telegram.org) شوید.
2. با شماره تلفن Telegram خود وارد شوید.
3. وارد بخش **API development tools** شوید.
4. یک Application جدید ایجاد کنید.
5. مقادیر `api_id` و `api_hash` را دریافت کنید.

این مقادیر را در فایل `.env` قرار دهید.

---

## 2. دریافت SESSION_STRING

`SESSION_STRING` اطلاعات Session حساب Telegram است و به برنامه اجازه می‌دهد بدون ورود مجدد به حساب متصل شود.

> **هشدار امنیتی:** `SESSION_STRING` مانند یک credential حساس است. آن را در GitHub، README یا اختیار افراد دیگر قرار ندهید.

در ریشه پروژه فایل زیر را اجرا کنید:

```bash
node getSession.js
```

برنامه اطلاعات زیر را از شما دریافت می‌کند:

1. شماره تلفن با کد کشور
2. کد تأیید Telegram
3. رمز عبور Two-Step Verification در صورت فعال بودن

پس از احراز هویت، Session String تولید می‌شود:

```text
********************************************************************
* YOUR_SESSION_STRING                                              *
********************************************************************
```

مقدار تولیدشده را در `.env` قرار دهید.

---

## 3. ایجاد فایل `.env`

در ریشه پروژه یک فایل با نام `.env` ایجاد کنید:

```env
# ==================== Required ====================

TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=your_api_hash_here
SESSION_STRING=your_session_string_here

# ==================== Optional ====================

# ----- Google Gemini -----

AI_API_KEY=your_google_gemini_api_key
AI_MODEL=gemini-3.5-flash-lite

# ----- MongoDB -----

MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname

# ----- Daily limits -----

DAILY_MESSAGE_LIMIT=150

# ----- Per-user limits -----

USER_LIMIT_MESSAGES=5
USER_LIMIT_HOURS=2

# ----- Global cooldown -----

GLOBAL_COOLDOWN_MINUTES=5

# ----- Owner -----

OWNER_ID=123456789

# ----- Music channel -----

MUSIC_CHANNEL_ID=your_channel_id
```

### متغیرهای محیطی

| Variable                  | Required | Description                              |
| ------------------------- | -------- | ---------------------------------------- |
| `TELEGRAM_API_ID`         | Yes      | شناسه Application دریافت‌شده از Telegram |
| `TELEGRAM_API_HASH`       | Yes      | Hash مربوط به Application                |
| `SESSION_STRING`          | Yes      | Session String حساب Telegram             |
| `AI_API_KEY`              | No       | کلید API مربوط به Google Gemini          |
| `AI_MODEL`                | No       | مدل Gemini مورد استفاده                  |
| `MONGO_URI`               | No       | Connection String مربوط به MongoDB       |
| `DAILY_MESSAGE_LIMIT`     | No       | حداکثر تعداد پاسخ‌های ربات در روز        |
| `USER_LIMIT_MESSAGES`     | No       | تعداد پیام مجاز برای هر کاربر            |
| `USER_LIMIT_HOURS`        | No       | بازه زمانی محدودیت کاربر برحسب ساعت      |
| `GLOBAL_COOLDOWN_MINUTES` | No       | مدت خاموشی سراسری ربات                   |
| `OWNER_ID`                | No       | Telegram ID مالک                         |
| `MUSIC_CHANNEL_ID`        | No       | شناسه کانال موسیقی                       |

---

## 4. نصب Dependencies

در مسیر اصلی پروژه اجرا کنید:

```bash
npm install
```

این دستور تمام Dependencies تعریف‌شده در `package.json` را نصب می‌کند.

---

## 5. راه‌اندازی MongoDB

استفاده از MongoDB اختیاری است، اما برای فعال بودن حافظه دائمی پروژه توصیه می‌شود.

### قابلیت‌هایی که MongoDB برای آن‌ها استفاده می‌شود

* ذخیره اطلاعات کاربران
* حافظه کاربران
* شخصیت تطبیقی
* Dictionary
* آمار تعاملات
* اطلاعات مربوط به تعاملات روزانه

### راه‌اندازی

1. یک Cluster در MongoDB Atlas ایجاد کنید.
2. Database موردنظر را ایجاد کنید.
3. Connection String را دریافت کنید.
4. مقدار آن را در `.env` قرار دهید:

```env
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname
```

اگر `MONGO_URI` تنظیم نشود، پروژه می‌تواند از حافظه موقت استفاده کند؛ اما اطلاعات پس از Restart شدن برنامه به‌صورت دائمی باقی نمی‌مانند.

---

## 6. دریافت Gemini API Key

برای فعال‌سازی پاسخ‌گویی هوشمند با Gemini، یک API Key از Google AI Studio دریافت کنید.

سپس در `.env` قرار دهید:

```env
AI_API_KEY=your_google_gemini_api_key
```

مدل را نیز می‌توانید مشخص کنید:

```env
AI_MODEL=gemini-flash-latest
```

اگر `AI_API_KEY` تنظیم نشود، سیستم پاسخ‌گویی هوش مصنوعی غیرفعال شده و ربات از Dictionary داخلی استفاده می‌کند.

---

## 7. اجرای ربات

بعد از تنظیم `.env`، پروژه را اجرا کنید:

```bash
npm start
```

یا:

```bash
node index.js
```

در صورت اجرای صحیح، چیزی مشابه خروجی زیر مشاهده می‌کنید:

```text
Userbot is running successfully
User : YourName (123456789)
```

ربات اکنون فعال است.

---

## 8. تست ربات

برای بررسی عملکرد:

### Private Chat

یک پیام ساده از طریق Private Chat ارسال کنید.

### Group

ربات را در گروه موردنظر قرار دهید و با Username آن را Mention کنید.

### Tone Detection

پیام‌هایی با لحن‌های مختلف ارسال کنید:

```text
مودبانه
بی‌ادبانه
عاشقانه
دوستانه
رسمی
```

سیستم باید بر اساس لحن تشخیص‌داده‌شده، رفتار و پاسخ مناسب را انتخاب کند.

---

# مدیریت و نگهداری

## Reset محدودیت روزانه

محدودیت پیام‌های روزانه هر روز ساعت `00:00` بر اساس Timezone سرور Reset می‌شود.

مقدار پیش‌فرض:

```env
DAILY_MESSAGE_LIMIT=150
```

---

## محدودیت هر کاربر

برای هر کاربر می‌توان تعداد پیام و بازه زمانی تعریف کرد:

```env
USER_LIMIT_MESSAGES=5
USER_LIMIT_HOURS=2
```

یعنی هر کاربر در بازه دو ساعته حداکثر ۵ پیام مجاز خواهد داشت.

---

## Global Cooldown

با تنظیم `OWNER_ID`، ارسال پیام توسط مالک می‌تواند باعث فعال شدن خاموشی سراسری ربات شود.

```env
OWNER_ID=123456789
GLOBAL_COOLDOWN_MINUTES=5
```

در این حالت، ربات برای مدت مشخص‌شده وارد حالت Cooldown می‌شود.

---

## به‌روزرسانی Personality و Dictionary

در صورت فعال بودن MongoDB، ربات می‌تواند به‌صورت دوره‌ای اطلاعات مربوط به:

* Personality
* Dictionary
* تعاملات روزانه
* رفتار کاربران

را بر اساس تعاملات ذخیره‌شده به‌روزرسانی کند.

---

## Periodic Ping

ربات به‌صورت دوره‌ای وضعیت اتصال خود را بررسی/به‌روزرسانی می‌کند.

بازه پیش‌فرض:

```text
5 minutes
```

---

# ساختار فایل‌های اصلی

```text
project/
│
├── index.js
├── getSession.js
├── aiHandler.js
├── toneDetector.js
├── userManager.js
├── personalityManager.js
├── dictionaryHandler.js
├── database.js
├── personality.js
├── package.json
├── package-lock.json
├── .env
└── .gitignore
```

### توضیح فایل‌ها

| File                    | Description                        |
| ----------------------- | ---------------------------------- |
| `index.js`              | Entry Point و فایل اصلی اجرای ربات |
| `getSession.js`         | تولید Telegram Session String      |
| `aiHandler.js`          | مدیریت ارتباط با Gemini            |
| `toneDetector.js`       | تشخیص لحن پیام کاربر               |
| `userManager.js`        | مدیریت کاربران و حافظه             |
| `personalityManager.js` | مدیریت Personality ربات            |
| `dictionaryHandler.js`  | مدیریت پاسخ‌های Dictionary         |
| `database.js`           | اتصال و مدیریت MongoDB             |
| `personality.js`        | Personality پیش‌فرض                |
| `.env`                  | تنظیمات و اطلاعات حساس پروژه       |

---

# امنیت

فایل `.env` حاوی اطلاعات حساس است.

هرگز موارد زیر را در GitHub قرار ندهید:

```text
.env
SESSION_STRING
TELEGRAM_API_HASH
AI_API_KEY
MONGO_URI
```

در `.gitignore` قرار دهید:

```gitignore
.env
node_modules/
```

در صورت انتشار Session String یا API Key، آن credential را فوراً Revoke/Regenerate کنید.

---

# عیب‌یابی

## `TELEGRAM_API_ID is empty`

بررسی کنید:

```env
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=your_api_hash
```

و مطمئن شوید `.env` در Root پروژه قرار دارد.

---

## `SESSION_STRING is invalid`

Session معتبر نیست یا دسترسی آن از بین رفته است.

دوباره اجرا کنید:

```bash
node getSession.js
```

و Session جدید را در `.env` قرار دهید.

---

## `FloodWaitError`

Telegram برای ارسال درخواست‌های زیاد محدودیت اعمال کرده است.

مدتی صبر کنید و از ارسال درخواست‌های مکرر خودداری کنید.

---

## `Gemini quota exceeded`

Quota مربوط به Gemini تمام شده است.

در این حالت سیستم می‌تواند به Dictionary داخلی Fallback کند.

---

## `MongoDB connection error`

موارد زیر را بررسی کنید:

```text
MONGO_URI
Internet Connection
MongoDB Atlas Network Access
Database User
Database Password
```

---

## پیام‌های تکراری

Dictionary یا Personality ممکن است نیاز به بررسی داشته باشد.

فایل‌های زیر را بررسی کنید:

```text
dictionaryHandler.js
personalityManager.js
personality.js
```

---

# Environment Variables Example

```env
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxx
SESSION_STRING=xxxxxxxxxxxxxxxxxxxxxxxx

AI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
AI_MODEL=gemini-flash-latest

MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname

DAILY_MESSAGE_LIMIT=150

USER_LIMIT_MESSAGES=5
USER_LIMIT_HOURS=2

GLOBAL_COOLDOWN_MINUTES=5

OWNER_ID=123456789

MUSIC_CHANNEL_ID=your_channel_id
```

---

# Quick Start

```bash
# Clone project
git clone <repository-url>

# Enter project
cd <project-directory>

# Install dependencies
npm install

# Create environment file
touch .env

# Configure .env

# Generate Telegram session
node getSession.js

# Start bot
npm start
```

یا:

```bash
node index.js
```

---

# وضعیت قابلیت‌ها

| Feature              | Required                                                   |
| -------------------- | ---------------------------------------------------------- |
| Telegram Connection  | `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` + `SESSION_STRING` |
| Gemini AI            | `AI_API_KEY`                                               |
| Persistent Memory    | `MONGO_URI`                                                |
| Adaptive Personality | `MONGO_URI`                                                |
| Dictionary Fallback  | بدون Dependency خارجی                                      |
| User Rate Limit      | `.env` Configuration                                       |
| Global Cooldown      | `OWNER_ID`                                                 |
| Music System         | `MUSIC_CHANNEL_ID`                                         |

---

## License

این پروژه یک پروژه شخصی است. شرایط استفاده و انتشار آن مطابق License تعریف‌شده در Repository پروژه خواهد بود.
