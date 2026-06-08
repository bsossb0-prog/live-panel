const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });
let activeStream = null;
let streamStartTime = null;

// 🔒 ইউজার ও পাসওয়ার্ড লিস্ট
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
    res.json({ isActive: activeStream !== null, startTime: streamStartTime });
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key, loop, token, mode } = req.body;
    let source = req.body.source;

    if (!USERS[token]) return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing details!");

    if (activeStream) {
        activeStream.kill('SIGKILL');
        activeStream = null;
    }

    if (type === 'file' && req.file) {
        source = req.file.path; 
        startFfmpeg(source, platform, key, loop, mode);
        return res.send("File uploaded! Starting High-Quality Stream...");
    } 
    
    if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be') || source.includes('dropbox.com')))) {
        // ড্রপবক্স লিংকের জন্য dl=1 নিশ্চিত করা
        let finalUrl = source;
        if(source.includes('dropbox.com') && !source.includes('dl=1')) {
            finalUrl = source.replace('dl=0', 'dl=1');
            if(!finalUrl.includes('dl=1')) finalUrl += '?dl=1';
        }

        exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${finalUrl}`, (error, stdout) => {
            if (error) return;
            startFfmpeg(stdout.trim(), platform, key, loop, mode);
        });
        return res.send("Link processed! Starting High-Quality Stream...");
    } 
    
    if (source) {
        startFfmpeg(source, platform, key, loop, mode);
        return res.send("Direct link processed! Starting High-Quality Stream...");
    }

    res.status(400).send("Invalid source!");
});

app.post('/stop-stream', (req, res) => {
    const { token } = req.body;
    if (!USERS[token]) return res.status(403).send("Unauthorized!");
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
    
    // 🌟 রেজোলিউশন ফিক্স (চেপটা হবে না) এবং ১০৮০পি আপস্কেলিং
    let scaleFilter;
    if (mode === 'shorts') {
        scaleFilter = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
    } else {
        scaleFilter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";
    }
    
    // হাই-কোয়ালিটি সেটিংস (2500k বিটরেট)
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -vf "${scaleFilter}" -c:v libx264 -preset ultrafast -b:v 2500k -maxrate 2500k -bufsize 5000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -f flv ${platform}/${key}`;
    
    console.log(`Starting ${mode} stream...`);
    streamStartTime = Date.now();
    activeStream = exec(ffmpegCmd);

    activeStream.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
    activeStream.on('exit', (code) => {
        if (input.includes('uploads/')) {
            try { fs.unlinkSync(input); } catch (e) {}
        }
        activeStream = null;
        streamStartTime = null;
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
