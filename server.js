const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });

// ৩টি আলাদা চ্যানেলের জন্য ডাটাবেস
let streams = {
    "1": { isActive: false, process: null, startTime: null },
    "2": { isActive: false, process: null, startTime: null },
    "3": { isActive: false, process: null, startTime: null }
};

const USERS = { "nayem": "password123" }; 
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
    const { channelId, platform, key, loop, token } = req.body;

    if (!VALID_TOKENS.has(token)) return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing Key!");

    const id = channelId;
    if (streams[id].isActive) {
        streams[id].process.kill('SIGKILL');
    }

    if (req.file) {
        const source = req.file.path;
        startFfmpeg(id, source, platform, key, loop);
        return res.send("Stream started successfully for Channel " + id);
    }
    res.status(400).send("No video file uploaded!");
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

    streams[id].process.on('exit', () => {
        streams[id].isActive = false;
        streams[id].process = null;
        streams[id].startTime = null;
        // আমরা ফাইলটি ডিলিট করছি না কারণ অন্য চ্যানেল সেটি ব্যবহার করতে পারে। 
        // Railway-তে মাঝে মাঝে অটোমেটিক ক্লিনিং হয়।
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
