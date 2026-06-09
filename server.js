const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

// ১ জিবি পর্যন্ত আপলোড সাপোর্ট করার জন্য লিমিট সেট করা হয়েছে
const upload = multer({ 
    dest: 'uploads/', 
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

let activeStreams = {}; 
let streamStartTimes = {};

const USERS = {
    "sakib": "sakib12",
    "rana12": "rana12hello",
    "admin": "password123"
};

app.use(express.static('.'));
app.use(express.json());

app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (USERS[user] && USERS[user] === pass) {
        return res.json({ token: user });
    }
    res.status(401).send("ভুল ইউজারনেম অথবা পাসওয়ার্ড!");
});

app.get('/status', (req, res) => {
    const token = req.query.token;
    res.json({ 
        isActive: activeStreams[token] !== null, 
        startTime: streamStartTimes[token] 
    });
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key, loop, token, mode, duration } = req.body;
    let source = req.body.source;

    if (!USERS[token]) return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing details!");

    if (activeStreams[token]) {
        activeStreams[token].kill('SIGKILL');
    }

    if (type === 'file' && req.file) {
        source = req.file.path; 
        startFfmpeg(token, source, platform, key, loop, mode, duration);
        return res.send("File uploaded! Stream starting...");
    } 
    
    if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be')))) {
        exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) return;
            startFfmpeg(token, stdout.trim(), platform, key, loop, mode, duration);
        });
        return res.send("YouTube link processed! Stream starting...");
    } 
    
    if (source) {
        startFfmpeg(token, source, platform, key, loop, mode, duration);
        return res.send("Direct link processed! Stream starting...");
    }

    res.status(400).send("Invalid source!");
});

app.post('/stop-stream', (req, res) => {
    const { token } = req.body;
    if (!USERS[token]) return res.status(403).send("Unauthorized!");
    if (activeStreams[token]) {
        activeStreams[token].kill('SIGKILL');
        activeStreams[token] = null;
        streamStartTimes[token] = null;
        return res.send("Stopped!");
    }
    res.send("No stream running.");
});

function startFfmpeg(token, input, platform, key, loop, mode, duration) {
    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    let scaleFilter = mode === 'shorts' ? 
        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" : 
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";
    
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -vf "${scaleFilter}" -c:v libx264 -preset ultrafast -b:v 1500k -maxrate 1500k -bufsize 3000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -f flv ${platform}/${key}`;
    
    streamStartTimes[token] = Date.now();
    const stream = exec(ffmpegCmd);
    activeStreams[token] = stream;

    // ⏱️ সময় সেট করার লজিক: যদি duration ০ না হয়, তবে নির্দিষ্ট সময় পর বন্ধ হয়ে যাবে
    if (duration && duration !== '0') {
        const durationMs = parseInt(duration) * 60 * 1000;
        setTimeout(() => {
            if (activeStreams[token]) {
                console.log(`Duration reached for ${token}. Stopping stream...`);
                activeStreams[token].kill('SIGKILL');
                activeStreams[token] = null;
                streamStartTimes[token] = null;
            }
        }, durationMs);
    }

    stream.stderr.on('data', (data) => console.log(`FFmpeg [${token}]: ${data}`));
    stream.on('exit', (code) => {
        if (input.includes('uploads/')) {
            try { fs.unlinkSync(input); } catch (e) {}
        }
        activeStreams[token] = null;
        streamStartTimes[token] = null;
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Master Panel running on port ${PORT}`));
