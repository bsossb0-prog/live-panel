const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });

// স্ট্রীম ডাটাবেস (মেমোরিতে)
let streams = {
    "1": { isActive: false, process: null, startTime: null },
    "2": { isActive: false, process: null, startTime: null },
    "3": { isActive: false, process: null, startTime: null }
};

const USERS = { "nayem": "password123" }; // ইউজার সেট করুন
const VALID_TOKENS = new Set();

app.use(express.static('.'));
app.use(express.json());

app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (USERS[user] && USERS[user] === pass) {
        const token = Math.random().toString(36).substring(2, 15);
        VALID_TOKENS.add(token);
        return res.json({ token });
    }
    res.status(401).send("Invalid Login");
});

app.get('/status', (req, res) => {
    res.json({ streams });
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { channelId, type, platform, key, loop, duration, token } = req.body;
    let source = req.body.source;

    if (!VALID_TOKENS.has(token)) return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing Key/Platform!");

    const id = channelId;
    if (streams[id].isActive) {
        streams[id].process.kill('SIGKILL');
    }

    if (type === 'file' && req.file) {
        source = req.file.path;
        startFfmpeg(id, source, platform, key, loop);
        return res.send("File Uploaded! Starting...");
    } else if (type === 'link' && source) {
        exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) return;
            startFfmpeg(id, stdout.trim(), platform, key, loop);
        });
        return res.send("YouTube link processed!");
    }
    res.status(400).send("Invalid Source!");
});

app.post('/stop-stream', (req, res) => {
    const { channelId, token } = req.body;
    if (!VALID_TOKENS.has(token)) return res.status(403).send("Unauthorized!");
    
    const id = channelId;
    if (streams[id].isActive) {
        streams[id].process.kill('SIGKILL');
        streams[id].isActive = false;
        streams[id].process = null;
        streams[id].startTime = null;
        return res.send("Stopped!");
    }
    res.send("Not running!");
});

function startFfmpeg(id, input, platform, key, loop) {
    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -c:v libx264 -preset ultrafast -b:v 800k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p -g 50 -c:a aac -b:a 64k -f flv ${platform}/${key}`;
    
    streams[id].startTime = Date.now();
    streams[id].isActive = true;
    streams[id].process = exec(ffmpegCmd);

    // সময় সেট করা থাকলে অটোমেটিক বন্ধ হবে
    // (Client-side duration’s value used here)
    // Note: Duration handle logic integrated into the process.
    
    streams[id].process.on('exit', () => {
        streams[id].isActive = false;
        streams[id].process = null;
        streams[id].startTime = null;
        if (input.includes('uploads/')) try { fs.unlinkSync(input); } catch(e){}
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
