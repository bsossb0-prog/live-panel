const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

// 🌟 ১ জিবি পর্যন্ত ফাইল আপলোড করার অনুমতি
const upload = multer({ 
    dest: 'uploads/', 
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB Limit
});

// মাল্টি-লাইভ ম্যানেজমেন্ট: প্রতিটি ইউজারের জন্য আলাদা প্রসেস
let activeStreams = {}; 
let streamStartTimes = {};

// 🔒 ইউজার এবং পাসওয়ার্ড লিস্ট
const USERS = {
    "sakib": "sakib12",
    "rana12": "rana12hello",
    "admin": "password123"
};

app.use(express.static('.'));
app.use(express.json());

// লগইন সিস্টেম
app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (USERS[user] && USERS[user] === pass) {
        return res.json({ token: user }); 
    }
    res.status(401).send("ভুল ইউজারনেম অথবা পাসওয়ার্ড!");
});

// স্ট্যাটাস চেক (টাইমারের জন্য)
app.get('/status', (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).send("Token required");
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

    // ওই নির্দিষ্ট ইউজারের আগের লাইভ চললে তা বন্ধ করা
    if (activeStreams[token]) {
        activeStreams[token].kill('SIGKILL');
        activeStreams[token] = null;
    }

    // ১. ফাইল আপলোড মোড
    if (type === 'file' && req.file) {
        source = req.file.path; 
        startFfmpeg(token, source, platform, key, loop, mode, duration);
        return res.send("High-Quality File uploaded! Stream starting...");
    } 
    
    // ২. ইউটিউব/লিংক মোড
    if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be') || source.includes('dropbox.com')))) {
        // ইউটিউব বা ড্রপবক্স থেকে ডিরেক্ট লিংক বের করা
        exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) {
                console.error("yt-dlp Error: " + error);
                return;
            }
            startFfmpeg(token, stdout.trim(), platform, key, loop, mode, duration);
        });
        return res.send("Link processed! Stream starting in 1080p...");
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
        return res.send("Your live stream has been stopped!");
    }
    res.send("No stream running for this user.");
});

function startFfmpeg(token, input, platform, key, loop, mode, duration) {
    // লুপ কি না চেক করা
    const loopCmd = (loop === 'true' || duration === 'loop') ? '-stream_loop -1 ' : '';
    
    // 🌟 হাই-কোয়ালিটি এবং নন-স্ট্রেচ (Aspect Ratio Fix) সেটিংস
    let scaleFilter;
    if (mode === 'shorts') {
        // শর্টস মোড: ১০৮০x১৯২০ (Vertical) - Center Crop করা হয়েছে যাতে চেপটা না হয়
        scaleFilter = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
    } else {
        // স্ট্যান্ডার্ড মোড: ১৯২০x১০৮০ (Horizontal) - Letterbox padding করা হয়েছে
        scaleFilter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";
    }
    
    // বিটরেট ৩০০০k রাখা হয়েছে যাতে ভিডিও একদম ক্লিয়ার দেখা যায়
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -vf "${scaleFilter}" -c:v libx264 -preset ultrafast -b:v 3000k -maxrate 3000k -bufsize 6000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -f flv ${platform}/${key}`;
    
    console.log(`User ${token} starting ${mode} stream...`);
    streamStartTimes[token] = Date.now();
    
    const stream = exec(ffmpegCmd);
    activeStreams[token] = stream;

    stream.stderr.on('data', (data) => console.log(`FFmpeg [${token}]: ${data}`));
    
    // ⏱️ নির্দিষ্ট সময় পর লাইভ বন্ধ করার লজিক
    if (duration !== 'loop') {
        const durationInMs = parseInt(duration) * 60 * 1000;
        setTimeout(() => {
            if (activeStreams[token]) {
                console.log(`Duration reached for ${token}. Stopping...`);
                activeStreams[token].kill('SIGKILL');
                activeStreams[token] = null;
                streamStartTimes[token] = null;
            }
        }, durationInMs);
    }

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
app.listen(PORT, () => console.log(`Master Multi-Stream Server running on port ${PORT}`));
