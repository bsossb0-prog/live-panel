const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });
let streams = {
    1: { process: null, startTime: null },
    2: { process: null, startTime: null },
    3: { process: null, startTime: null }
};
let masterVideoPath = null;

const USERS = { "nayem": "password123" }; // ইউজারনেম পাসওয়ার্ড সেট করুন
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
    res.status(401).send("Unauthorized");
});

app.get('/status', (req, res) => {
    const status = {};
    for (let id in streams) {
        status[id] = { isActive: streams[id].process !== null, startTime: streams[id].startTime };
    }
    res.json({ streams: status });
});

app.post('/upload-master', upload.single('videoFile'), (req, res) => {
    const { token } = req.body;
    if (!VALID_TOKENS.has(token)) return res.status(403).send("Unauthorized");
    if (req.file) {
        if (masterVideoPath) try { fs.unlinkSync(masterVideoPath); } catch(e){}
        masterVideoPath = req.file.path;
        return res.send("Master Video Ready!");
    }
    res.status(400).send("Upload failed");
});

app.post('/start-stream', (req, res) => {
    const { channelId, key, duration, loop, token, platform } = req.body;
    if (!VALID_TOKENS.has(token)) return res.status(403).send("Unauthorized");
    if (!masterVideoPath) return res.status(400).send("Please upload master video first!");

    const id = channelId;
    if (streams[id].process) streams[id].process.kill('SIGKILL');

    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${masterVideoPath}" -c:v libx264 -preset ultrafast -b:v 800k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p -g 50 -c:a aac -b:a 64k -f flv ${platform}/${key}`;
    
    streams[id].startTime = Date.now();
    streams[id].process = exec(ffmpegCmd);

    if (duration && parseInt(duration) > 0) {
        setTimeout(() => stopStream(id), parseInt(duration) * 60 * 1000);
    }

    res.send("Channel Live!");
});

app.post('/stop-stream', (req, res) => {
    const { channelId, token } = req.body;
    if (!VALID_TOKENS.has(token)) return res.status(403).send("Unauthorized");
    const id = channelId;
    if (streams[id].process) {
        streams[id].process.kill('SIGKILL');
        streams[id].process = null;
        streams[id].startTime = null;
        return res.send("Stopped!");
    }
    res.send("Not running");
});

function stopStream(id) {
    if (streams[id].process) {
        streams[id].process.kill('SIGKILL');
        streams[id].process = null;
        streams[id].startTime = null;
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
