const express = require('express');
const { spawn } = require('child_process');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const USER_FILE = './users.json';
const UPLOAD_DIR = 'uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR + '/' });

let activeStreams = {};
let streamStartTimes = {};
let activeInputs = {};
let limitTimers = {};
let limitFinishedUsers = {};

function loadUsers() {
  let users = {};
  if (fs.existsSync(USER_FILE)) {
    try { users = JSON.parse(fs.readFileSync(USER_FILE, 'utf8')); } catch (e) { users = {}; }
  }
  if (!users.admin) users.admin = { pass: 'password123', totalTime: 0, limitType: 'unlimited', limitMinutes: 0, uploads: 0 };
  for (const user in users) {
    users[user].pass = users[user].pass || '1234';
    users[user].totalTime = Number(users[user].totalTime || 0);
    users[user].limitType = users[user].limitType || 'unlimited';
    users[user].limitMinutes = Number(users[user].limitMinutes || 0);
    users[user].uploads = Number(users[user].uploads || 0);
  }
  saveUsers(users);
  return users;
}
function saveUsers(users) { fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2)); }
function clearLimitTimer(user) { if (limitTimers[user]) clearTimeout(limitTimers[user]); limitTimers[user] = null; }
function getUsedTime(user) {
  const users = loadUsers();
  let used = Number(users[user]?.totalTime || 0);
  if (activeStreams[user] && streamStartTimes[user]) used += Date.now() - streamStartTimes[user];
  return used;
}
function getLimitMs(user) {
  const users = loadUsers();
  const data = users[user];
  if (!data || data.limitType !== 'limited') return null;
  return Math.max(0, Number(data.limitMinutes || 0) * 60 * 1000);
}
function getRemainingMs(user) {
  const limitMs = getLimitMs(user);
  if (limitMs === null) return null;
  return Math.max(0, limitMs - getUsedTime(user));
}
function saveRunningTime(user) {
  if (!streamStartTimes[user]) return;
  const duration = Date.now() - streamStartTimes[user];
  const users = loadUsers();
  if (users[user]) {
    users[user].totalTime = Number(users[user].totalTime || 0) + Math.max(0, duration);
    users[user].lastStoppedAt = Date.now();
    saveUsers(users);
  }
}
function stopUserStream(user, reason = 'manual') {
  clearLimitTimer(user);
  if (!activeStreams[user]) { streamStartTimes[user] = null; return false; }
  saveRunningTime(user);
  try { activeStreams[user].kill('SIGKILL'); } catch (e) {}
  activeStreams[user] = null;
  streamStartTimes[user] = null;
  const input = activeInputs[user];
  if (input && String(input).startsWith(UPLOAD_DIR + '/')) { try { fs.unlinkSync(input); } catch (e) {} }
  activeInputs[user] = null;
  if (reason === 'limit') {
    limitFinishedUsers[user] = Date.now();
    const users = loadUsers();
    if (users[user]) { users[user].limitFinishedAt = Date.now(); saveUsers(users); }
  }
  return true;
}
function scheduleLimitStop(user) {
  clearLimitTimer(user);
  const remaining = getRemainingMs(user);
  if (remaining === null) return;
  if (remaining <= 0) { stopUserStream(user, 'limit'); return; }
  limitTimers[user] = setTimeout(() => stopUserStream(user, 'limit'), remaining + 250);
}
function userStatus(user) {
  const users = loadUsers();
  const data = users[user];
  const remainingMs = getRemainingMs(user);
  return {
    user,
    isActive: !!activeStreams[user],
    startTime: streamStartTimes[user] || null,
    totalTime: Number(data?.totalTime || 0),
    usedTime: getUsedTime(user),
    limitType: data?.limitType || 'unlimited',
    limitMinutes: Number(data?.limitMinutes || 0),
    remainingMs,
    limitFinished: !!limitFinishedUsers[user] || (data?.limitType === 'limited' && remainingMs === 0),
    streamKey: data?.streamKey || data?.lastStreamKey || '',
    uploads: Number(data?.uploads || 0),
    platform: data?.platform || '',
    mode: data?.mode || ''
  };
}

app.use(express.static('.'));
app.use(express.json({ limit: '2mb' }));

app.post('/login', (req, res) => {
  const { user, pass } = req.body;
  const users = loadUsers();
  if (users[user] && users[user].pass === pass) return res.json({ token: user, user });
  res.status(401).send('Wrong Username or Password!');
});

app.get('/status', (req, res) => {
  const token = req.query.token;
  const users = loadUsers();
  if (!token || !users[token]) return res.status(403).send('Unauthorized');
  if (activeStreams[token]) {
    const remaining = getRemainingMs(token);
    if (remaining !== null && remaining <= 0) stopUserStream(token, 'limit');
  }
  res.json(userStatus(token));
});

app.get('/admin/users', (req, res) => {
  if (req.query.token !== 'admin') return res.status(403).send('Admin only!');
  const users = loadUsers();
  const stats = {};
  for (const user in users) {
    if (user === 'admin') continue;
    const st = userStatus(user);
    stats[user] = {
      pass: users[user].pass || '', password: users[user].pass || '',
      totalTime: Number(users[user].totalTime || 0), usedTime: st.usedTime,
      isActive: st.isActive, isLive: st.isActive,
      startTime: st.startTime, liveStartTime: st.startTime,
      limitType: st.limitType, limitMinutes: st.limitMinutes,
      remainingMs: st.remainingMs, limitFinished: st.limitFinished,
      streamKey: users[user].streamKey || users[user].lastStreamKey || '',
      lastStreamKey: users[user].lastStreamKey || users[user].streamKey || '',
      uploads: Number(users[user].uploads || 0), platform: users[user].platform || '', mode: users[user].mode || ''
    };
  }
  res.json(stats);
});

app.post('/change-password', (req, res) => {
  const { token, oldPass, pass } = req.body;
  const users = loadUsers();
  if (!token || !pass || !users[token]) return res.status(403).send('Unauthorized!');
  if (oldPass && users[token].pass !== oldPass) return res.status(401).send('Wrong old password!');
  users[token].pass = pass;
  saveUsers(users);
  res.send('Password Changed!');
});

app.post('/admin/add-user', (req, res) => {
  const { user, pass, token, limitType, limitMinutes } = req.body;
  if (token !== 'admin') return res.status(403).send('Admin only!');
  if (!user || !pass) return res.status(400).send('Missing Details!');
  const users = loadUsers();
  users[user] = {
    pass,
    totalTime: Number(users[user]?.totalTime || 0),
    limitType: limitType === 'limited' ? 'limited' : 'unlimited',
    limitMinutes: limitType === 'limited' ? Number(limitMinutes || 0) : 0,
    uploads: Number(users[user]?.uploads || 0),
    streamKey: users[user]?.streamKey || '',
    lastStreamKey: users[user]?.lastStreamKey || ''
  };
  delete limitFinishedUsers[user];
  saveUsers(users);
  res.send('User Added!');
});

app.post('/admin/delete-user', (req, res) => {
  const { user, token } = req.body;
  if (token !== 'admin') return res.status(403).send('Admin only!');
  if (user === 'admin') return res.status(400).send('Admin cannot be deleted!');
  const users = loadUsers();
  stopUserStream(user, 'deleted');
  delete users[user];
  saveUsers(users);
  res.send('User Deleted!');
});

app.post('/admin/change-user-password', (req, res) => {
  const { user, pass, token } = req.body;
  if (token !== 'admin') return res.status(403).send('Admin only!');
  const users = loadUsers();
  if (!users[user]) return res.status(404).send('User Not Found!');
  users[user].pass = pass;
  saveUsers(users);
  res.send('User Password Changed!');
});

app.post('/admin/update-user-limit', (req, res) => {
  const { user, token, limitType, limitMinutes } = req.body;
  if (token !== 'admin') return res.status(403).send('Admin only!');
  const users = loadUsers();
  if (!users[user]) return res.status(404).send('User Not Found!');
  users[user].limitType = limitType === 'limited' ? 'limited' : 'unlimited';
  users[user].limitMinutes = users[user].limitType === 'limited' ? Number(limitMinutes || 0) : 0;
  users[user].limitFinishedAt = null;
  delete limitFinishedUsers[user];
  saveUsers(users);
  scheduleLimitStop(user);
  res.send('User Limit Updated!');
});

app.post('/admin/add-time', (req, res) => {
  const { user, token, minutes } = req.body;
  if (token !== 'admin') return res.status(403).send('Admin only!');
  const users = loadUsers();
  if (!users[user]) return res.status(404).send('User Not Found!');
  users[user].limitType = 'limited';
  users[user].limitMinutes = Number(users[user].limitMinutes || 0) + Number(minutes || 0);
  users[user].limitFinishedAt = null;
  delete limitFinishedUsers[user];
  saveUsers(users);
  scheduleLimitStop(user);
  res.send('Time Added!');
});

app.post('/admin/reset-time', (req, res) => {
  const { user, token } = req.body;
  if (token !== 'admin') return res.status(403).send('Admin only!');
  const users = loadUsers();
  if (!users[user]) return res.status(404).send('User Not Found!');
  users[user].totalTime = 0;
  users[user].limitFinishedAt = null;
  delete limitFinishedUsers[user];
  if (activeStreams[user]) streamStartTimes[user] = Date.now();
  saveUsers(users);
  scheduleLimitStop(user);
  res.send('Time Reset!');
});

app.post('/admin/stop-user-stream', (req, res) => {
  const { user, token } = req.body;
  if (token !== 'admin') return res.status(403).send('Admin only!');
  const users = loadUsers();
  if (!users[user]) return res.status(404).send('User Not Found!');
  const stopped = stopUserStream(user, 'admin');
  if (!stopped) return res.status(404).send('This user is not live now.');
  res.send('User Live Stopped!');
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
  const { type, platform, key, loop, token, mode } = req.body;
  let source = req.body.source;
  const users = loadUsers();
  if (!users[token]) return res.status(403).send('Unauthorized!');
  if (token === 'admin') return res.status(403).send('Admin cannot start live!');
  if (!platform || !key) return res.status(400).send('Missing Details!');

  const remaining = getRemainingMs(token);
  if (remaining !== null && remaining <= 0) {
    limitFinishedUsers[token] = Date.now();
    return res.status(403).send('LIMIT_FINISHED');
  }

  users[token].streamKey = key;
  users[token].lastStreamKey = key;
  users[token].platform = platform;
  users[token].mode = mode || 'standard';
  users[token].lastSourceType = type || '';
  users[token].uploads = Number(users[token].uploads || 0) + 1;
  users[token].limitFinishedAt = null;
  saveUsers(users);
  delete limitFinishedUsers[token];

  if (activeStreams[token]) stopUserStream(token, 'restart');

  if (type === 'file' && req.file) {
    source = req.file.path;
    startFfmpeg(token, source, platform, key, loop, mode);
    return res.send('File uploaded! Starting Stream...');
  }
  if (type === 'link' && source) {
    let finalUrl = source;
    if (source.includes('dropbox.com')) finalUrl = source.replace('dl=0', 'dl=1');
    if (source.includes('youtube.com') || source.includes('youtu.be')) {
      getYoutubeDirectUrl(source, (err, url) => {
        if (err || !url) return console.error('yt-dlp error:', err || 'No URL');
        startFfmpeg(token, url.trim(), platform, key, loop, mode);
      });
      return res.send('YouTube processed! Starting...');
    }
    startFfmpeg(token, finalUrl, platform, key, loop, mode);
    return res.send('Link processed! Starting...');
  }
  res.status(400).send('Invalid Source!');
});

app.post('/stop-stream', (req, res) => {
  const { token } = req.body;
  const users = loadUsers();
  if (!users[token]) return res.status(403).send('Unauthorized!');
  const stopped = stopUserStream(token, 'manual');
  if (stopped) return res.send('Stopped!');
  res.send('No stream running.');
});

function getYoutubeDirectUrl(url, callback) {
  const p = spawn('yt-dlp', ['--user-agent', 'Mozilla/5.0', '-f', 'best[ext=mp4]/best', '-g', url]);
  let stdout = '', stderr = '';
  p.stdout.on('data', d => stdout += d.toString());
  p.stderr.on('data', d => stderr += d.toString());
  p.on('close', code => {
    if (code !== 0) return callback(stderr || `yt-dlp exited ${code}`);
    callback(null, stdout.trim().split('\n')[0]);
  });
}

function startFfmpeg(token, input, platform, key, loop, mode) {
  const output = `${platform}/${key}`;
  const scaleFilter = mode === 'shorts'
    ? 'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280'
    : 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2';
  const args = ['-re'];
  if (loop === 'true') args.push('-stream_loop', '-1');
  args.push('-i', input, '-vf', `${scaleFilter},unsharp=3:3:1.0:3:3:0.0`, '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k', '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac', '-b:a', '128k', '-f', 'flv', output);
  console.log(`Starting stream for ${token}`);
  streamStartTimes[token] = Date.now();
  activeInputs[token] = input;
  activeStreams[token] = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  scheduleLimitStop(token);
  activeStreams[token].stdout.on('data', d => console.log(`[ffmpeg ${token}] ${d.toString()}`));
  activeStreams[token].stderr.on('data', d => console.log(`[ffmpeg ${token}] ${d.toString()}`));
  activeStreams[token].on('exit', code => {
    console.log(`Stream ended for ${token}. code=${code}`);
    clearLimitTimer(token);
    if (activeStreams[token]) saveRunningTime(token);
    const inputFile = activeInputs[token];
    if (inputFile && String(inputFile).startsWith(UPLOAD_DIR + '/')) { try { fs.unlinkSync(inputFile); } catch (e) {} }
    activeStreams[token] = null;
    streamStartTimes[token] = null;
    activeInputs[token] = null;
  });
}

app.listen(PORT, () => console.log(`Live Panel Server Ready on port ${PORT}`));
