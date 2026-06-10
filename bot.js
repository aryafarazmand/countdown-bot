const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const http = require('http');

// ── Keep-alive server (برای Render رایگان) ──────────────────────────────────
http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 3000);

// ── ربات ────────────────────────────────────────────────────────────────────
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const userState = {};  // وضعیت مکالمه هر کاربر
const events    = {};  // رویدادهای هر چت

// ── helpers ──────────────────────────────────────────────────────────────────
function daysUntil(isoDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function dayLabel(d) {
  if (d < 0)  return `${Math.abs(d)} روز پیش گذشت ⌛`;
  if (d === 0) return 'امروزه! 🎉';
  if (d === 1) return 'فردا ⚡';
  return `${d} روز مانده ⏳`;
}

function eventLine(ev) {
  return `🎯 ${ev.name}\n📅 ${ev.date}\n${dayLabel(daysUntil(ev.date))}`;
}

// ── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '👋 سلام! من ربات شمارش معکوسم.\n\n' +
    '📌 دستورات:\n' +
    '/add — اضافه کردن رویداد جدید\n' +
    '/list — لیست همه رویدادها\n' +
    '/delete — حذف یه رویداد\n' +
    '/help — راهنما'
  );
});

// ── /help ────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '📖 راهنما:\n\n' +
    '1️⃣ /add بزن\n' +
    '2️⃣ اسم رویداد رو بنویس\n' +
    '3️⃣ تاریخ رو به این شکل بنویس: 2025-12-31\n\n' +
    'رویداد ثبت و پین میشه ✅\n' +
    'هر روز صبح ساعت ۸ یادآوری میفرستم 🔔'
  );
});

// ── /add ─────────────────────────────────────────────────────────────────────
bot.onText(/\/add/, (msg) => {
  userState[msg.chat.id] = { step: 'waitName' };
  bot.sendMessage(msg.chat.id, '📝 اسم رویداد رو بنویس:');
});

// ── /list ────────────────────────────────────────────────────────────────────
bot.onText(/\/list/, (msg) => {
  const list = events[msg.chat.id];
  if (!list || list.length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ هنوز رویدادی ثبت نکردی.\n/add بزن تا اضافه کنی.');
  }
  let text = '📋 رویدادهای تو:\n\n';
  list.forEach((ev, i) => {
    text += `${i + 1}. ${eventLine(ev)}\n\n`;
  });
  bot.sendMessage(msg.chat.id, text);
});

// ── /delete ──────────────────────────────────────────────────────────────────
bot.onText(/\/delete/, (msg) => {
  const list = events[msg.chat.id];
  if (!list || list.length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ رویدادی برای حذف نداری.');
  }
  let text = '🗑 کدوم رویداد رو حذف کنم؟\nشماره بنویس:\n\n';
  list.forEach((ev, i) => {
    text += `${i + 1}. ${ev.name} — ${ev.date}\n`;
  });
  userState[msg.chat.id] = { step: 'waitDelete' };
  bot.sendMessage(msg.chat.id, text);
});

// ── پردازش پیام‌های معمولی ───────────────────────────────────────────────────
bot.on('message', (msg) => {
  const state = userState[msg.chat.id];
  if (!state || !msg.text || msg.text.startsWith('/')) return;

  // ── مرحله: دریافت اسم رویداد ──
  if (state.step === 'waitName') {
    userState[msg.chat.id] = { step: 'waitDate', name: msg.text.trim() };
    bot.sendMessage(msg.chat.id,
      `✅ اسم ثبت شد: "${msg.text.trim()}"\n\n` +
      '📅 حالا تاریخ رو بنویس:\nفرمت: YYYY-MM-DD\nمثال: 2025-09-01'
    );

  // ── مرحله: دریافت تاریخ ──
  } else if (state.step === 'waitDate') {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(msg.text.trim())) {
      return bot.sendMessage(msg.chat.id,
        '❌ فرمت اشتباهه!\nمثال درست: 2025-09-01'
      );
    }
    const newEvent = { name: state.name, date: msg.text.trim() };
    if (!events[msg.chat.id]) events[msg.chat.id] = [];
    events[msg.chat.id].push(newEvent);
    userState[msg.chat.id] = null;

    const d = daysUntil(newEvent.date);
    bot.sendMessage(msg.chat.id,
      `📌 رویداد ثبت شد!\n\n${eventLine(newEvent)}`
    ).then(sentMsg => {
      // پین کردن پیام
      bot.pinChatMessage(msg.chat.id, sentMsg.message_id)
        .catch(() => {
          bot.sendMessage(msg.chat.id,
            '⚠️ نتونستم پین کنم.\nاگه توی گروهی، ربات رو ادمین کن.'
          );
        });
    });

  // ── مرحله: حذف رویداد ──
  } else if (state.step === 'waitDelete') {
    const num = parseInt(msg.text.trim());
    const list = events[msg.chat.id];
    if (isNaN(num) || num < 1 || num > list.length) {
      return bot.sendMessage(msg.chat.id, '❌ شماره اشتباهه. دوباره امتحان کن.');
    }
    const removed = list.splice(num - 1, 1)[0];
    userState[msg.chat.id] = null;
    bot.sendMessage(msg.chat.id, `✅ رویداد "${removed.name}" حذف شد.`);
  }
});

// ── یادآوری روزانه ساعت ۸ صبح ───────────────────────────────────────────────
cron.schedule('0 8 * * *', () => {
  Object.entries(events).forEach(([chatId, list]) => {
    if (!list || list.length === 0) return;
    list.forEach(ev => {
      const d = daysUntil(ev.date);
      if (d >= 0) {
        bot.sendMessage(chatId, `🔔 یادآوری:\n\n${eventLine(ev)}`);
      }
    });
  });
}, { timezone: 'Asia/Tehran' });

console.log('✅ ربات روشنه!');
