// ======================================================================
// getSession.js - ساخت Session String برای ورود ربات به تلگرام
// ======================================================================

// ---- import ها ----
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
    console.error("ERROR: TELEGRAM_API_ID and TELEGRAM_API_HASH must be set in .env");
    process.exit(1);
}

// ---- پرسیدن سوال از کاربر در ترمینال ----
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// ---- تابع اصلی ساخت سشن ----
async function getSession() {
    console.log("=== Session String Generator ===\n");

    const client = new TelegramClient(
        new StringSession(""),
        apiId,
        apiHash,
        {
            connectionRetries: 5,
            shouldReconnect: true,
        }
    );

    try {
        // مرحله ۱: شماره تلفن
        const phoneNumber = await askQuestion("Phone number (with country code, e.g. 989123456789): ");
        
        // مرحله ۲: ورود به تلگرام
        await client.start({
            phoneNumber: phoneNumber,
            password: async () => {
                return await askQuestion("Two-factor password (if any): ");
            },
            phoneCode: async () => {
                return await askQuestion("Verification code from Telegram: ");
            },
            onError: (err) => {
                console.error("Login error:", err.message);
                process.exit(1);
            }
        });

        // مرحله ۳: نمایش سشن
        const sessionString = client.session.save();
        
        console.log("\n=== Your Session String ===");
        console.log(sessionString);
        console.log("============================\n");
        console.log("Copy this string and add it to your .env file as SESSION_STRING");
        console.log("Example: SESSION_STRING=" + sessionString);

        // مرحله ۴: ذخیره خودکار در .env
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            if (envContent.includes('SESSION_STRING=')) {
                envContent = envContent.replace(/^SESSION_STRING=.*$/m, `SESSION_STRING=${sessionString}`);
            } else {
                envContent += `\nSESSION_STRING=${sessionString}`;
            }
            fs.writeFileSync(envPath, envContent, 'utf8');
            console.log("\nSession string automatically saved to .env file.");
        } else {
            console.log("\n.env file not found. Please add SESSION_STRING manually.");
        }

        await client.destroy();
        console.log("\nDone. You can now run the main bot with npm start.");
        process.exit(0);

    } catch (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
}

// ---- اجرا ----
getSession();
