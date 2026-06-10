const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const http = require('http');

// ── Keep-alive server ────────────────────────────────────────────────────────
http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 3000);

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// ── دیتابیس در حافظه ────────────────────────────────────────────────────────
// events[chatId] = [ { name, startDate, totalDays, pinMsgId? }, ... ]
const events    = {};
const userState = {};

// ── helpers ──────────────────────────────────────────────────────────────────
function daysLeft(startDate, totalDays) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const passed = Math.round((today - start) / 86400000);
  return Math.max(totalDays - passed, 0);
}

function buildPinText(ev) {
  const left = daysLeft(ev.startDate, ev.totalDays);
  const bar  = progressBar(left, ev.totalDays);
  const emoji = left === 0 ? '🎉' : left <= 3 ? '🔴' : left <= 7 ? '🟠' : left <= 14 ? '🟡' : '🟢';
  return (
    `${emoji} *${ev.name}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `⏳ *${left}* روز مانده از *${ev.totalDays}* روز\n` +
    `${bar}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📅 شروع: ${formatDate(ev.startDate)}\n` +
    `🏁 پایان: ${formatDate(endDate(ev.startDate, ev.totalDays))}`
  );
}

function progressBar(left, total) {
  const filled = Math.round(((total - left) / total) * 10);
  const empty  = 10 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${Math.round(((total - left) / total) * 100)}%`;
}

function formatDate(isoDate) {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function endDate(startDate, totalDays) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + totalDays);
  return formatDate(d);
}

function todayISO() {
  return formatDate(new Date());
}

// ── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '👋 سلام! ربات شمارش معکوس آماده‌ست.\n\n' +
    '📌 دستورات:\n' +
    '/add — رویداد جدید\n' +
    '/list — لیست رویدادها\n' +
    '/delete — حذف رویداد\n' +
    '/forward — متن آماده برای فوروارد\n' +
    '/help — راهنما',
    { parse_mode: 'Markdown' }
  );
});

// ── /help ────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    '📖 *راهنما:*\n\n' +
    '1️⃣ /add بزن\n' +
    '2️⃣ اسم رویداد رو بنویس\n' +
    '3️⃣ تعداد روز رو بنویس (مثلاً: 30)\n\n' +
    '✅ رویداد ثبت و پین میشه\n' +
    '🔄 هر روز صبح ساعت 8 عدد آپدیت میشه\n' +
    '📤 با /forward میتونی به گفتگوهای دیگه بفرستی',
    { parse_mode: 'Markdown' }
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
    return bot.sendMessage(msg.chat.id, '❌ رویدادی ثبت نشده.\n/add بزن تا اضافه کنی.');
  }
  list.forEach((ev, i) => {
    const left = daysLeft(ev.startDate, ev.totalDays);
    const emoji = left === 0 ? '🎉' : left <= 3 ? '🔴' : left <= 7 ? '🟠' : left <= 14 ? '🟡' : '🟢';
    bot.sendMessage(msg.chat.id,
      `${emoji} *${i+1}. ${ev.name}*\n` +
      `⏳ *${left}* روز مانده از *${ev.totalDays}* روز\n` +
      `🏁 پایان: ${endDate(ev.startDate, ev.totalDays)}`,
      { parse_mode: 'Markdown' }
    );
  });
});

// ── /delete ──────────────────────────────────────────────────────────────────
bot.onText(/\/delete/, (msg) => {
  const list = events[msg.chat.id];
  if (!list || list.length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ رویدادی برای حذف وجود نداره.');
  }
  let text = '🗑 کدوم رویداد رو حذف کنم؟\nشماره بنویس:\n\n';
  list.forEach((ev, i) => {
    text += `${i+1}. ${ev.name} — ${daysLeft(ev.startDate, ev.totalDays)} روز مانده\n`;
  });
  userState[msg.chat.id] = { step: 'waitDelete' };
  bot.sendMessage(msg.chat.id, text);
});

// ── /forward ─────────────────────────────────────────────────────────────────
bot.onText(/\/forward/, (msg) => {
  const list = events[msg.chat.id];
  if (!list || list.length === 0) {
    return bot.sendMessage(msg.chat.id, '❌ رویدادی ثبت نشده.');
  }
  if (list.length === 1) {
    return sendForwardable(msg.chat.id, list[0]);
  }
  let text = '📤 کدوم رویداد رو فوروارد کنم؟\nشماره بنویس:\n\n';
  list.forEach((ev, i) => {
    text += `${i+1}. ${ev.name}\n`;
  });
  userState[msg.chat.id] = { step: 'waitForward' };
  bot.sendMessage(msg.chat.id, text);
});

function sendForwardable(chatId, ev) {
  const left = daysLeft(ev.startDate, ev.totalDays);
  const bar  = progressBar(left, ev.totalDays);
  const emoji = left === 0 ? '🎉' : left <= 3 ? '🔴' : left <= 7 ? '🟠' : left <= 14 ? '🟡' : '🟢';
  bot.sendMessage(chatId,
    `${emoji} *${ev.name}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `⏳ *${left}* روز مانده\n` +
    `${bar}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📅 تا تاریخ: ${endDate(ev.startDate, ev.totalDays)}\n\n` +
    `_این پیام رو فوروارد کن 👆_`,
    { parse_mode: 'Markdown' }
  );
}

// ── پردازش پیام‌ها ────────────────────────────────────────────────────────────
bot.on('message', (msg) => {
  const state = userState[msg.chat.id];
  if (!state || !msg.text || msg.text.startsWith('/')) return;

  // اسم رویداد
  if (state.step === 'waitName') {
    userState[msg.chat.id] = { step: 'waitDays', name: msg.text.trim() };
    bot.sendMessage(msg.chat.id,
      `✅ اسم: *${msg.text.trim()}*\n\n` +
      '📆 حالا تعداد روز رو بنویس:\nمثال: 30',
      { parse_mode: 'Markdown' }
    );

  // تعداد روز
  } else if (state.step === 'waitDays') {
    const days = parseInt(msg.text.trim());
    if (isNaN(days) || days < 1) {
      return bot.sendMessage(msg.chat.id, '❌ یه عدد درست بنویس. مثال: 30');
    }
    const newEvent = {
      name: state.name,
      startDate: todayISO(),
      totalDays: days
    };
    if (!events[msg.chat.id]) events[msg.chat.id] = [];
    events[msg.chat.id].push(newEvent);
    userState[msg.chat.id] = null;

    const pinText = buildPinText(newEvent);
    bot.sendMessage(msg.chat.id, `✅ ثبت شد!\n\n${pinText}`, { parse_mode: 'Markdown' })
      .then(sentMsg => {
        newEvent.pinMsgId = sentMsg.message_id;
        bot.pinChatMessage(msg.chat.id, sentMsg.message_id)
          .then(() => bot.sendMessage(msg.chat.id, '📌 پین شد!'))
          .catch(() => bot.sendMessage(msg.chat.id, '⚠️ پین نشد — ربات رو ادمین کن.'));
      });

  // حذف
  } else if (state.step === 'waitDelete') {
    const num = parseInt(msg.text.trim());
    const list = events[msg.chat.id];
    if (isNaN(num) || num < 1 || num > list.length) {
      return bot.sendMessage(msg.chat.id, '❌ شماره اشتباهه.');
    }
    const removed = list.splice(num - 1, 1)[0];
    userState[msg.chat.id] = null;
    bot.sendMessage(msg.chat.id, `✅ "${removed.name}" حذف شد.`);

  // فوروارد
  } else if (state.step === 'waitForward') {
    const num = parseInt(msg.text.trim());
    const list = events[msg.chat.id];
    if (isNaN(num) || num < 1 || num > list.length) {
      return bot.sendMessage(msg.chat.id, '❌ شماره اشتباهه.');
    }
    userState[msg.chat.id] = null;
    sendForwardable(msg.chat.id, list[num - 1]);
  }
});

// ── آپدیت روزانه ساعت ۸ صبح ─────────────────────────────────────────────────
cron.schedule('0 8 * * *', () => {
  Object.entries(events).forEach(([chatId, list]) => {
    if (!list || list.length === 0) return;
    list.forEach(ev => {
      const left = daysLeft(ev.startDate, ev.totalDays);
      const pinText = buildPinText(ev);

      // ارسال پیام جدید و پین کردن
      bot.sendMessage(chatId, pinText, { parse_mode: 'Markdown' })
        .then(sentMsg => {
          // پین پیام جدید
          bot.pinChatMessage(chatId, sentMsg.message_id).catch(() => {});
          // حذف پین قبلی
          if (ev.pinMsgId && ev.pinMsgId !== sentMsg.message_id) {
            bot.deleteMessage(chatId, ev.pinMsgId).catch(() => {});
          }
          ev.pinMsgId = sentMsg.message_id;

          // یادآوری
          if (left === 0) {
            bot.sendMessage(chatId, `🎉 *${ev.name}* امروز به پایان رسید!`, { parse_mode: 'Markdown' });
          } else {
            bot.sendMessage(chatId, `🔔 *${ev.name}* — *${left}* روز مانده`, { parse_mode: 'Markdown' });
          }
        })
        .catch(() => {});
    });
  });
}, { timezone: 'Asia/Tehran' });

console.log('✅ ربات روشنه!');
