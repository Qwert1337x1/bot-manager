const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const v = require('vec3');

const PORT = process.env.PORT || 3005;

const MC_CONFIG = {
  host: 'skimc.pl',
  port: 25565,
  version: '1.20.1'
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const NICKS_FILE = path.join(__dirname, 'nicks.json');
let savedNicks = [];
try { savedNicks = JSON.parse(fs.readFileSync(NICKS_FILE, 'utf8')); } catch(e) { savedNicks = []; }
function saveNicks() { try { fs.writeFileSync(NICKS_FILE, JSON.stringify(savedNicks)); } catch(e) {} }

const bots = {};
const botPasswords = {};
const farmActive = {};

function log(nick, msg) {
  const time = new Date().toLocaleTimeString('pl-PL', { hour12: false });
  io.emit('log', { nick, msg: `[${time}] ${msg}` });
}

function broadcastStatuses() {
  const statuses = {};
  for (const nick in bots) {
    statuses[nick] = {
      online: !!(bots[nick] && bots[nick].entity),
      farmActive: !!farmActive[nick]
    };
  }
  io.emit('statuses', statuses);
}

function humanDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function farmTick(nick) {
  if (!farmActive[nick]) return;
  const bot = bots[nick];
  if (!bot || !bot.entity) { stopFarm(nick); return; }
  try {
    const entity = bot.nearestEntity(e => {
      if (!e || !e.position) return false;
      if (e === bot.entity) return false;
      if (e.username) return false;
      return bot.entity.position.distanceTo(e.position) < 4.0;
    });
    if (entity) { bot.swingArm(); bot.attack(entity); }
  } catch(e) {}
  if (farmActive[nick]) setTimeout(() => farmTick(nick), humanDelay(700, 1000));
}

function startFarm(nick) {
  if (farmActive[nick]) return;
  const bot = bots[nick];
  if (!bot) return;
  farmActive[nick] = true;
  log(nick, '⚔️ Farm uruchomiony.');
  broadcastStatuses();
  setTimeout(() => farmTick(nick), humanDelay(200, 500));
}

function stopFarm(nick) {
  if (!farmActive[nick]) return;
  farmActive[nick] = false;
  log(nick, '🛑 Farm zatrzymany.');
  broadcastStatuses();
}

function waitForCompassAndClick(username) {
  const bot = bots[username];
  if (!bot) return;
  let tries = 0;
  const interval = setInterval(async () => {
    if (!bots[username]) { clearInterval(interval); return; }
    tries++;
    if (tries > 30) { clearInterval(interval); log(username, '⚠️ Nie znaleziono kompasu po 30s.'); return; }
    const slots = bot.inventory.slots.slice(36, 45);
    const compassIdx = slots.findIndex(i => i && i.name && i.name.toLowerCase().includes('compass'));
    if (compassIdx !== -1) {
      clearInterval(interval);
      log(username, `🧭 Znaleziono kompas, klikam...`);
      try {
        bot.setQuickBarSlot(compassIdx);
        await new Promise(r => setTimeout(r, 600));
        bot.activateItem();
        log(username, '🧭 Kompas kliknięty - czekam na GUI...');
      } catch(e) { log(username, '❌ Błąd klikania kompasu: ' + e.message); }
    }
  }, 1000);
}

async function walkForward5(username) {
  const bot = bots[username];
  if (!bot || !bot.entity) return;
  log(username, '🚶 Idę 5 bloków prosto...');
  try {
    bot.setControlState('forward', true);
    await new Promise(r => setTimeout(r, 2500));
    bot.setControlState('forward', false);
    bot.clearControlStates();
    log(username, '✋ Zatrzymano - AFK aktywny.');
  } catch(e) {
    bot.clearControlStates();
    log(username, '❌ Błąd ruchu: ' + e.message);
  }
}

function doAfkSequence(username) {
  const bot = bots[username];
  if (!bot) return;
  log(username, '🌀 AFK: wysyłam /warp...');
  bot.chat('/warp');
}

function createBot(username, password) {
  botPasswords[username] = password || 'Dawidpro#12';
  if (bots[username]) {
    try { bots[username].quit(); } catch(e) {}
    delete bots[username];
  }
  log(username, '🚀 Łączenie...');

  const bot = mineflayer.createBot({
    host: MC_CONFIG.host,
    port: MC_CONFIG.port,
    username,
    version: MC_CONFIG.version,
    auth: 'offline'
  });

  bots[username] = bot;
  bot._registered = false;
  bot._setupDone = false;
  broadcastStatuses();

  bot.on('message', (jsonMsg) => {
    const msg = jsonMsg.toString();
    const lower = msg.toLowerCase();
    io.emit('chat', { nick: username, msg });

    if (!bot._registered && (lower.includes('zarejestruj') || lower.includes('/register') || lower.includes('nie jeste') || lower.includes('niezarejestrowan'))) {
      setTimeout(() => {
        if (bots[username]) {
          bots[username].chat(`/register ${botPasswords[username]} ${botPasswords[username]}`);
          log(username, '📝 /register wysłany.');
          bot._registered = true;
        }
      }, 800);
    }

    if (lower.includes('/login') || lower.includes('zaloguj się') || lower.includes('wpisz has')) {
      setTimeout(() => {
        if (bots[username]) {
          bots[username].chat(`/login ${botPasswords[username]}`);
          log(username, '🔐 /login wysłany.');
        }
      }, 800);
    }
  });

  bot.on('windowOpen', (window) => {
    const items = window.slots.map((i, idx) => i ? `[${idx}] ${i.name}` : null).filter(Boolean);
    log(username, `📦 GUI: ${window.title || '?'} | ${items.join(', ') || 'brak itemów'}`);

    const clockSlot = window.slots.findIndex(i => i && i.name && i.name.toLowerCase().includes('clock'));
    if (clockSlot !== -1) {
      setTimeout(async () => {
        bot.clickWindow(clockSlot, 0, 0);
        log(username, '⏰ Kliknięto clock - czekam 3s...');
        await new Promise(r => setTimeout(r, 3000));
        walkForward5(username);
      }, 6000);
      return;
    }

    if (!bot._setupDone) {
      const elytraSlot = window.slots.findIndex(i => i && i.name && i.name.toLowerCase().includes('elytra'));
      if (elytraSlot !== -1) {
        setTimeout(() => {
          bot.clickWindow(elytraSlot, 0, 0);
          log(username, '🪂 Kliknięto elytrę.');
          bot._setupDone = true;
        }, 800);
      }
    }
  });

  bot.once('spawn', () => {
    log(username, '✅ Połączono z serwerem.');
    broadcastStatuses();
    setTimeout(() => waitForCompassAndClick(username), 3000);
  });

  bot.on('spawn', () => { broadcastStatuses(); });

  bot.on('error', (err) => { log(username, `❌ Błąd: ${err.message}`); });

  bot.on('end', () => {
    log(username, '🔌 Rozłączono.');
    if (farmActive[username]) stopFarm(username);
    delete bots[username];
    broadcastStatuses();
  });

  bot.on('kicked', (reason) => {
    let r = '';
    try {
      if (typeof reason === 'string') r = reason;
      else if (reason && reason.text) r = reason.text;
      else if (reason && reason.extra) r = reason.extra.map(e => e.text || '').join('');
      else r = JSON.stringify(reason);
    } catch(e) { r = String(reason); }
    log(username, `🦶 Wyrzucono: ${r}`);
  });
}

io.on('connection', (socket) => {
  socket.emit('nicks', savedNicks);
  socket.emit('server-config', MC_CONFIG);
  broadcastStatuses();

  socket.on('get-nicks', () => socket.emit('nicks', savedNicks));
  socket.on('get-statuses', () => broadcastStatuses());
  socket.on('get-server', () => socket.emit('server-config', MC_CONFIG));

  socket.on('set-server', ({ host, port, version }) => {
    MC_CONFIG.host = host;
    MC_CONFIG.port = port;
    MC_CONFIG.version = version;
    io.emit('server-config', MC_CONFIG);
  });

  socket.on('add-nick', (nick) => {
    if (nick && !savedNicks.includes(nick)) {
      savedNicks.push(nick);
      saveNicks();
      io.emit('nicks', savedNicks);
    }
  });

  socket.on('remove-nick', (nick) => {
    savedNicks = savedNicks.filter(n => n !== nick);
    saveNicks();
    io.emit('nicks', savedNicks);
  });

  socket.on('connect-bot', ({ nick, password }) => {
    if (nick && nick.trim()) createBot(nick.trim(), password);
  });

  socket.on('disconnect-bot', (nick) => {
    if (bots[nick]) {
      try { bots[nick].quit(); } catch(e) {}
      delete bots[nick];
      broadcastStatuses();
    }
  });

  socket.on('connect-all', (password) => {
    savedNicks.forEach(nick => { if (!bots[nick]) createBot(nick, password); });
  });

  socket.on('disconnect-all', () => {
    Object.keys(bots).forEach(nick => {
      try { bots[nick].quit(); } catch(e) {}
      delete bots[nick];
    });
    broadcastStatuses();
  });

  socket.on('send-chat', ({ nick, msg }) => {
    if (bots[nick] && msg) bots[nick].chat(msg);
  });

  socket.on('send-chat-all', (msg) => {
    Object.keys(bots).forEach(nick => { if (bots[nick] && msg) bots[nick].chat(msg); });
  });

  socket.on('start-farm', (nick) => startFarm(nick));
  socket.on('stop-farm', (nick) => stopFarm(nick));
  socket.on('start-farm-all', () => { Object.keys(bots).forEach(startFarm); });
  socket.on('stop-farm-all', () => { Object.keys(bots).forEach(stopFarm); });

  socket.on('afk-warp', (nick) => doAfkSequence(nick));
  socket.on('afk-warp-all', async () => {
    const nickList = Object.keys(bots);
    for (const nick of nickList) {
      doAfkSequence(nick);
      await new Promise(r => setTimeout(r, 3000));
    }
  });

  socket.on('drop-hotbar', async (nick) => {
    const bot = bots[nick];
    if (!bot) return;
    for (let slot = 36; slot <= 44; slot++) {
      const item = bot.inventory.slots[slot];
      if (item) {
        try { await bot.tossStack(item); } catch(e) {}
        await new Promise(r => setTimeout(r, 100));
      }
    }
    log(nick, '🗑️ Hotbar wyczyszczony.');
  });

  socket.on('drop-hotbar-all', async () => {
    for (const nick of Object.keys(bots)) {
      const bot = bots[nick];
      if (!bot) continue;
      for (let slot = 36; slot <= 44; slot++) {
        const item = bot.inventory.slots[slot];
        if (item) {
          try { await bot.tossStack(item); } catch(e) {}
          await new Promise(r => setTimeout(r, 100));
        }
      }
      log(nick, '🗑️ Hotbar wyczyszczony.');
    }
  });
});

server.listen(PORT, () => console.log(`Bot Manager running on port ${PORT}`));
