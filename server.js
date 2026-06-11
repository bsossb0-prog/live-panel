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
    res.status(401).send("Wrong Password!");
});

app.get('/status', (req, res) => {
    const token = req.query.token;
    res.json({ 
        isActive: !!activeStreams[token], 
        startTime: streamStartTimes[token] 
    });
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key, loop, token, mode } = req.body;
    let source = req.body.source;

    if (!USERS[token]) return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing Details!");

    if (activeStreams[token]) {
        activeStreams[token].kill('SIGKILL');
    }

    if (type === 'file' && req.file) {
        source = req.file.path; 
        startFfmpeg(token, source, platform, key, loop, mode);
        return res.send("File uploaded! Starting HD Stream...");
    } 
    
    if (type === 'link' && source) {
        let finalUrl = source;
        if (source.includes('dropbox.com')) {
            finalUrl = source.replace('dl=0', 'dl=1');
        } else if (source.includes('youtube.com') || source.includes('youtu.be')) {
            exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
                if (error) return;
                startFfmpeg(token, stdout.trim(), platform, key, loop, mode);
            });
            return res.send("YouTube link processed! Starting HD Stream...");
        } else {
            startFfmpeg(token, finalUrl, platform, key, loop, mode);
        }
        return res.send("Link processed! Starting HD Stream...");
    }
    res.status(400).send("Invalid Source!");
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

function startFfmpeg(token, input, platform, key, loop, mode) {
    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    
    let scaleFilter;
    if (mode === 'shorts') {
        scaleFilter = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
    } else {
        scaleFilter = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2";
    }
    
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -vf "${scaleFilter},unsharp=3:3:1.0:3:3:0.0" -c:v libx264 -preset ultrafast -b:v 1500k -maxrate 1500k -bufsize 3000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -flvflags no_duration_filesize -f flv ${platform}/${key}`;
    
    console.log(`User ${token} starting HD Stream...`);
    streamStartTimes[token] = Date.now();
    
    const stream = exec(ffmpegCmd);
    activeStreams[token] = stream;

    stream.stderr.on('data', (data) => console.log(`FFmpeg [${token}]: ${data}`));
    stream.on('exit', (code) => {
        console.log(`Stream ${token} exited with code ${code}`);
        if (input.includes('uploads/')) {
            try { fs.unlinkSync(input); } catch (e) {}
        }
        activeStreams[token] = null;
        streamStartTimes[token] = null;
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Premium Multi-User Server running on port ${PORT}`));
