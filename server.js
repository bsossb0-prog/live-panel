const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });
let activeStream = null;
let streamStartTime = null;

// 🔒 ইউজার লিস্ট (এখানে আপনি আপনার ইউজারনেম এবং পাসওয়ার্ড সেট করুন)
const USERS = {
    "nayem": "password123", // উদাহরণ: ইউজারনেম 'nayem', পাসওয়ার্ড 'password123'
    "boss": "admin786"       // আপনি এভাবে আরও ইউজার যোগ করতে পারেন
};

const VALID_TOKENS = new Set(); // লগইন করা ইউজারদের টোকেন এখানে থাকবে

app.use(express.static('.'));
app.use(express.json());

// লগইন এন্ডপয়েন্ট
app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (USERS[user] && USERS[user] === pass) {
        const token = Math.random().toString(36).substring(2, 15); // সিম্পল টোকেন তৈরি
        VALID_TOKENS.add(token);
        return res.json({ token });
    }
    res.status(401).send("Invalid credentials");
});

// স্ট্যাটাস চেক
app.get('/status', (req, res) => {
    res.json({ isActive: activeStream !== null, startTime: streamStartTime });
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key, loop, token } = req.body;
    let source = req.body.source;

    // সিকিউরিটি চেক: টোকেন সঠিক কি না
    if (!VALID_TOKENS.has(token)) return res.status(403).send("Error: Unauthorized access!");
    if (!platform || !key) return res.status(400).send("Error: Platform and Key are required!");

    if (activeStream) {
        activeStream.kill('SIGKILL');
        activeStream = null;
    }

    if (type === 'file' && req.file) {
        source = req.file.path; 
        startFfmpeg(source, platform, key, loop);
        return res.send("File uploaded! Stream starting...");
    } 
    
    if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be')))) {
        exec(`yt-dlp --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) return;
            startFfmpeg(stdout.trim(), platform, key, loop);
        });
        return res.send("YouTube link processed! Stream starting...");
    } 
    
    if (source) {
        startFfmpeg(source, platform, key, loop);
        return res.send("Direct link processed! Stream starting...");
    }

    res.status(400).send("Error: No valid source provided!");
});

app.post('/stop-stream', (req, res) => {
    const { token } = req.body;
    if (!VALID_TOKENS.has(token)) return res.status(403).send("Error: Unauthorized access!");

    if (activeStream) {
        activeStream.kill('SIGKILL');
        activeStream = null;
        streamStartTime = null;
        return res.send("লাইভ স্ট্রিম সফলভাবে বন্ধ করা হয়েছে!");
    }
    res.send("কোনো লাইভ স্ট্রিম চলছে না।");
});

function startFfmpeg(input, platform, key, loop) {
    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -c:v libx264 -preset ultrafast -b:v 800k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p -g 50 -c:a aac -b:a 64k -f flv ${platform}/${key}`;
    
    streamStartTime = Date.now();
    activeStream = exec(ffmpegCmd);

    activeStream.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
    activeStream.on('exit', (code) => {
        console.log(`Stream exited with code ${code}`);
        if (input.includes('uploads/')) {
            try { fs.unlinkSync(input); } catch (e) {}
        }
        activeStream = null;
        streamStartTime = null;
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
