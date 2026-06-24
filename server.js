const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });
let activeStreams = {}; 
let streamStartTimes = {};

const USER_FILE = './users.json';

// 🌟 আপডেট করা লোড ইউজার ফাংশন (এডমিন রিকভারি সিস্টেম)
function loadUsers() {
    let users = {};
    if (fs.existsSync(USER_FILE)) {
        try {
            users = JSON.parse(fs.readFileSync(USER_FILE));
        } catch (e) {
            users = {};
        }
    }

    // 🚨 যদি ফাইল থাকে কিন্তু এডমিন ইউজার ডিলেট হয়ে যায়, তবে এখানে অটো-তৈরি হবে
    if (!users["admin"]) {
        console.log("Admin not found! Recovering admin account...");
        users["admin"] = { "pass": "password123", "totalTime": 0 };
        saveUsers(users);
    }
    return users;
}

function saveUsers(users) {
    fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
}

app.use(express.static('.'));
app.use(express.json());

app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    const users = loadUsers();
    if (users[user] && users[user].pass === pass) {
        return res.json({ token: user });
    }
    res.status(401).send("Wrong Password!");
});

app.get('/status', (req, res) => {
    const token = req.query.token;
    const users = loadUsers();
    if (!users[token]) return res.status(403).send("Unauthorized");
    res.json({ isActive: !!activeStreams[token], startTime: streamStartTimes[token] });
});

app.get('/admin/users', (req, res) => {
    const users = loadUsers();
    const stats = {};
    for (let u in users) {
        const isActive = !!activeStreams[u];
        stats[u] = {
            pass: users[u].pass || '',
            password: users[u].pass || '',
            totalTime: users[u].totalTime || 0,
            isActive: isActive,
            isLive: isActive,
            startTime: streamStartTimes[u] || null,
            liveStartTime: streamStartTimes[u] || null,
            streamKey: users[u].streamKey || '',
            lastStreamKey: users[u].lastStreamKey || users[u].streamKey || '',
            uploads: users[u].uploads || 0,
            platform: users[u].platform || '',
            mode: users[u].mode || ''
        };
    }
    res.json(stats);
});

app.post('/change-password', (req, res) => {
    const { token, pass } = req.body;
    if (!token || !pass) return res.status(400).send("Missing Details!");
    const users = loadUsers();
    if (!users[token]) return res.status(403).send("Unauthorized!");
    users[token].pass = pass;
    saveUsers(users);
    res.send("Password Changed!");
});

app.post('/admin/change-password', (req, res) => {
    const { token, currentPass, newPass } = req.body;
    if (token !== 'admin') return res.status(403).send("Admin only!");
    if (!currentPass || !newPass) return res.status(400).send("Missing Details!");
    const users = loadUsers();
    if (!users.admin || users.admin.pass !== currentPass) return res.status(401).send("Wrong Current Password!");
    users.admin.pass = newPass;
    saveUsers(users);
    res.send("Admin Password Changed!");
});

app.post('/admin/change-user-password', (req, res) => {
    const { user, pass, token } = req.body;
    if (token !== 'admin') return res.status(403).send("Admin only!");
    if (!user || !pass) return res.status(400).send("Missing Details!");
    const users = loadUsers();
    if (!users[user]) return res.status(404).send("User Not Found!");
    users[user].pass = pass;
    saveUsers(users);
    res.send("User Password Changed!");
});

app.post('/admin/add-user', (req, res) => {
    const { user, pass, token } = req.body;
    if (token !== 'admin') return res.status(403).send("Admin only!");
    const users = loadUsers();
    users[user] = { pass: pass, totalTime: 0 };
    saveUsers(users);
    res.send("User Added!");
});

app.post('/admin/delete-user', (req, res) => {
    const { user, token } = req.body;
    if (token !== 'admin') return res.status(403).send("Admin only!");
    const users = loadUsers();
    if (activeStreams[user]) activeStreams[user].kill('SIGKILL');
    delete users[user];
    saveUsers(users);
    res.send("User Deleted!");
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key, loop, token, mode } = req.body;
    let source = req.body.source;
    const users = loadUsers();
    if (!users[token]) return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing Details!");

    users[token].streamKey = key;
    users[token].lastStreamKey = key;
    users[token].platform = platform;
    users[token].mode = mode || 'standard';
    users[token].lastSourceType = type || '';
    users[token].uploads = (users[token].uploads || 0) + 1;
    users[token].lastUpdated = Date.now();
    saveUsers(users);

    if (activeStreams[token]) activeStreams[token].kill('SIGKILL');

    if (type === 'file' && req.file) {
        source = req.file.path; 
        startFfmpeg(token, source, platform, key, loop, mode);
        return res.send("File uploaded! Starting HD Stream...");
    } 
    if (type === 'link' && source) {
        let finalUrl = source;
        if (source.includes('dropbox.com')) finalUrl = source.replace('dl=0', 'dl=1');
        else if (source.includes('youtube.com') || source.includes('youtu.be')) {
            exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
                if (error) return;
                startFfmpeg(token, stdout.trim(), platform, key, loop, mode);
            });
            return res.send("YouTube processed! Starting...");
        } else {
            startFfmpeg(token, finalUrl, platform, key, loop, mode);
        }
        return res.send("Link processed! Starting...");
    }
    res.status(400).send("Invalid Source!");
});

app.post('/stop-stream', (req, res) => {
    const { token } = req.body;
    const users = loadUsers();
    if (!users[token]) return res.status(403).send("Unauthorized!");
    if (activeStreams[token]) {
        const duration = Date.now() - streamStartTimes[token];
        const updated = loadUsers();
        updated[token].totalTime = (updated[token].totalTime || 0) + duration;
        saveUsers(updated);
        activeStreams[token].kill('SIGKILL');
        activeStreams[token] = null;
        streamStartTimes[token] = null;
        return res.send("Stopped!");
    }
    res.send("No stream running.");
});

function startFfmpeg(token, input, platform, key, loop, mode) {
    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    let scaleFilter = mode === 'shorts' ? 
        "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" : 
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2";
    
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -vf "${scaleFilter},unsharp=3:3:1.0:3:3:0.0" -c:v libx264 -preset ultrafast -b:v 1500k -maxrate 1500k -bufsize 3000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -f flv ${platform}/${key}`;
    
    streamStartTimes[token] = Date.now();
    activeStreams[token] = exec(ffmpegCmd);
    activeStreams[token].on('exit', () => {
        if (input.includes('uploads/')) try { fs.unlinkSync(input); } catch (e) {}
        activeStreams[token] = null;
        streamStartTimes[token] = null;
    });
}

app.listen(process.env.PORT || 3000, () => console.log(`Admin Recovery Server Ready!`));
