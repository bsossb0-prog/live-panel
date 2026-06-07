const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });
let activeStreams = {
    "1": { isActive: false, process: null, startTime: null },
    "2": { isActive: false, process: null, startTime: null },
    "3": { isActive: false, process: null, startTime: null }
};

let masterVideoPath = null;

// 🔒 ইউজার লিস্ট (আপনার ইউজারনেম এবং পাসওয়ার্ড এখানে সেট করুন)
const USERS = { "nayem": "password123" }; 
const GLOBAL_SECRET_TOKEN = "MASTER_BOSS_SECRET_TOKEN_99"; 

app.use(express.static('.'));
app.use(express.json());

app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (USERS[user] && USERS[user] === pass) {
        return res.json({ token: GLOBAL_SECRET_TOKEN });
    }
    res.status(401).send("Invalid Login");
});

app.get('/status', (req, res) => {
    res.json({ streams: activeStreams });
});

app.post('/upload-master', upload.single('videoFile'), (req, res) => {
    const { token } = req.body;
    if (token !== GLOBAL_SECRET_TOKEN) return res.status(403).send("Unauthorized!");
    
    if (req.file) {
        if (masterVideoPath && fs.existsSync(masterVideoPath)) {
            fs.unlinkSync(masterVideoPath);
        }
        masterVideoPath = req.file.path;
        return res.send("Master Video uploaded successfully!");
    }
    res.status(400).send("No file uploaded!");
});

app.post('/start-stream', (req, res) => {
    const { channelId, platform, key, loop, token } = req.body;

    if (token !== GLOBAL_SECRET_TOKEN) return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing Key!");
    if (!masterVideoPath) return res.status(400).send("Please upload a Master Video first!");

    const id = channelId;
    if (activeStreams[id].isActive) {
        activeStreams[id].process.kill('SIGKILL');
    }

    startFfmpeg(id, masterVideoPath, platform, key, loop);
    res.send("Channel " + id + " is now LIVE!");
});

app.post('/stop-stream', (req, res) => {
    const { channelId, token } = req.body;
    if (token !== GLOBAL_SECRET_TOKEN) return res.status(403).send("Unauthorized!");
    
    const id = channelId;
    if (activeStreams[id].isActive) {
        activeStreams[id].process.kill('SIGKILL');
        activeStreams[id].isActive = false;
        activeStreams[id].process = null;
        activeStreams[id].startTime = null;
        return res.send("Stopped!");
    }
    res.send("Not running!");
});

function startFfmpeg(id, input, platform, key, loop) {
    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -c:v libx264 -preset ultrafast -b:v 800k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p -g 50 -c:a aac -b:a 64k -f flv ${platform}/${key}`;
    
    activeStreams[id].startTime = Date.now();
    activeStreams[id].isActive = true;
    activeStreams[id].process = exec(ffmpegCmd);

    activeStreams[id].process.on('exit', () => {
        activeStreams[id].isActive = false;
        activeStreams[id].process = null;
        activeStreams[id].startTime = null;
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
