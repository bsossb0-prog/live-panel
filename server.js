const express = require('express');
const { exec } = require('child_process');
const app = express();

let activeStream = null;
let streamStartTime = null;

// 🔒 ইউজার এবং পাসওয়ার্ড এখানে সেট করুন
const USERS = { 
    "nayem": "password123" 
};

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
    res.json({ isActive: activeStream !== null, startTime: streamStartTime });
});

app.post('/start-stream', (req, res) => {
    const { source, platform, key, loop, token } = req.body;

    if (!VALID_TOKENS.has(token)) return res.status(403).send("Unauthorized!");
    if (!platform || !key || !source) return res.status(400).send("Missing Data!");

    if (activeStream) activeStream.kill('SIGKILL');

    let finalInput = source;
    if (source.includes('youtube.com') || source.includes('youtu.be')) {
        exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) return;
            startFfmpeg(stdout.trim(), platform, key, loop);
        });
    } else {
        startFfmpeg(source, platform, key, loop);
    }

    res.send("Stream started successfully!");
});

app.post('/stop-stream', (req, res) => {
    const { token } = req.body;
    if (!VALID_TOKENS.has(token)) return res.status(403).send("Unauthorized!");

    if (activeStream) {
        activeStream.kill('SIGKILL');
        activeStream = null;
        streamStartTime = null;
        return res.send("Stopped!");
    }
    res.send("Not running!");
});

function startFfmpeg(input, platform, key, loop) {
    const loopCmd = loop === 'true' || loop === true ? '-stream_loop -1 ' : '';
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -c:v libx264 -preset ultrafast -b:v 800k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p -g 50 -c:a aac -b:a 64k -f flv ${platform}/${key}`;
    
    streamStartTime = Date.now();
    activeStream = exec(ffmpegCmd);
    activeStream.on('exit', () => {
        activeStream = null;
        streamStartTime = null;
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
