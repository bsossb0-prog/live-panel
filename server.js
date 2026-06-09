const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });
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
    const { platform, key, loop, token, mode, duration } = req.body;
    
    if (!USERS[token]) return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing details!");

    if (!req.file) return res.status(400).send("Please upload a video file!");

    if (activeStreams[token]) {
        activeStreams[token].kill('SIGKILL');
    }

    const source = req.file.path; 
    startFfmpeg(token, source, platform, key, loop, mode, duration);
    return res.send("File uploaded! Starting Stable HD Stream...");
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
    
    // 🌟 স্থিতিশীল এইচডি সেটিংস (720p)
    // রেজোলিউশন ৭২০পি রাখা হয়েছে যাতে সার্ভার ক্র্যাশ না করে কিন্তু ভিডিও পরিষ্কার থাকে
    let scaleFilter = mode === 'shorts' ? 
        "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" : 
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2";
    
    // বিটরেট ১০০০k - এটি ফ্রি সার্ভারের জন্য সবচেয়ে নিরাপদ এবং ক্লিয়ার সেটিংস
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -vf "${scaleFilter}" -c:v libx264 -preset ultrafast -b:v 1000k -maxrate 1000k -bufsize 2000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 96k -f flv ${platform}/${key}`;
    
    console.log(`Starting stable stream for ${token}...`);
    streamStartTimes[token] = Date.now();
    
    const stream = exec(ffmpegCmd);
    activeStreams[token] = stream;

    stream.stderr.on('data', (data) => console.log(`FFmpeg [${token}]: ${data}`));
    stream.on('exit', (code) => {
        console.log(`Stream for ${token} exited with code ${code}`);
        if (input.includes('uploads/')) {
            try { fs.unlinkSync(input); } catch (e) {}
        }
        activeStreams[token] = null;
        streamStartTimes[token] = null;
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stable-Stream Server running on port ${PORT}`));
