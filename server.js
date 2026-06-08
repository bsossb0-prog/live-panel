const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });
let activeStream = null;
let streamStartTime = null;

const ADMIN_PASSWORD = "password123"; 

app.use(express.static('.'));
app.use(express.json());

app.post('/login', (req, res) => {
    const { pass } = req.body;
    if (pass === ADMIN_PASSWORD) {
        return res.json({ token: "auth_success" });
    }
    res.status(401).send("ভুল পাসওয়ার্ড!");
});

app.get('/status', (req, res) => {
    res.json({ 
        isActive: activeStream !== null, 
        startTime: streamStartTime 
    });
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key, loop, token, mode } = req.body;
    let source = req.body.source;

    if (token !== "auth_success") return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing details!");

    if (activeStream) {
        activeStream.kill('SIGKILL');
        activeStream = null;
    }

    if (type === 'file' && req.file) {
        source = req.file.path; 
        startFfmpeg(source, platform, key, loop, mode);
        return res.send("File uploaded! Stream starting...");
    } 
    
    if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be')))) {
        exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) return;
            startFfmpeg(stdout.trim(), platform, key, loop, mode);
        });
        return res.send("YouTube link processed! Stream starting...");
    } 
    
    if (source) {
        startFfmpeg(source, platform, key, loop, mode);
        return res.send("Direct link processed! Stream starting...");
    }

    res.status(400).send("Invalid source!");
});

app.post('/stop-stream', (req, res) => {
    const { token } = req.body;
    if (token !== "auth_success") return res.status(403).send("Unauthorized!");
    if (activeStream) {
        activeStream.kill('SIGKILL');
        activeStream = null;
        streamStartTime = null;
        return res.send("Stopped!");
    }
    res.send("No stream running");
});

function startFfmpeg(input, platform, key, loop, mode) {
    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    
    let scaleFilter;
    if (mode === 'shorts') {
        scaleFilter = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
    } else {
        scaleFilter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";
    }
    
    // বিটরেট ১২০০k রাখা হয়েছে যাতে কোয়ালিটিও থাকে এবং সার্ভার ক্র্যাশ না করে
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -vf "${scaleFilter}" -c:v libx264 -preset ultrafast -b:v 1200k -maxrate 1200k -bufsize 2400k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -f flv ${platform}/${key}`;
    
    console.log("Starting Stream...");
    streamStartTime = Date.now(); 
    activeStream = exec(ffmpegCmd);

    activeStream.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
    activeStream.on('exit', (code) => {
        console.log(`Exited with code ${code}`);
        if (input.includes('uploads/')) {
            try { fs.unlinkSync(input); } catch (e) {}
        }
        activeStream = null;
        streamStartTime = null;
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
