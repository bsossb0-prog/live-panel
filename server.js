const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

// ৯০০ এমবি বা তার বেশি ফাইল আপলোডের জন্য লিমিট বাড়ানো হয়েছে
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 1000 * 1024 * 1024 } // ১ জিবি পর্যন্ত লিমিট
});

let activeStream = null;
let streamStartTime = null;

const ADMIN_PASSWORD = "password123"; 

app.use(express.static('.'));
app.use(express.json());

app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (USERS[user] && USERS[user] === pass) {
        return res.json({ token: "auth_success" });
    }
    res.status(401).send("ভুল ইউজারনেম অথবা পাসওয়ার্ড!");
});

// ইউজার লিস্ট (আগের মতোই)
const USERS = {
    "sakib": "sakib12",
    "rana12": "rana12hello",
    "admin": "password123"
};

app.get('/status', (req, res) => {
    res.json({ isActive: activeStream !== null, startTime: streamStartTime });
});

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key, loop, token } = req.body;
    let source = req.body.source;

    if (token !== "auth_success") return res.status(403).send("Unauthorized!");
    if (!platform || !key) return res.status(400).send("Missing details!");

    if (activeStream) {
        activeStream.kill('SIGKILL');
        activeStream = null;
    }

    if (type === 'file' && req.file) {
        source = req.file.path; 
        startFfmpeg(source, platform, key, loop);
        return res.send("Big file uploaded! Starting stream... Please wait 2-3 minutes.");
    } 
    
    if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be')))) {
        exec(`yt-dlp --user-agent "Mozilla/5.0" -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) return;
            startFfmpeg(stdout.trim(), platform, key, loop);
        });
        return res.send("YouTube link processed! Stream starting...");
    } 
    
    if (source) {
        startFfmpeg(source, platform, key, loop);
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

function startFfmpeg(input, platform, key, loop) {
    const loopCmd = loop === 'true' ? '-stream_loop -1 ' : '';
    
    // 🚀 মেমোরি সেভিং সেটিংস (Max Stability for Big Files)
    // -threads 1 : সার্ভার যেন ক্র্যাশ না করে তাই মাত্র ১টি থ্রেড ব্যবহার করা হয়েছে
    // -b:v 1000k : মাঝারি কোয়ালিটি যাতে র‍্যাম কম লাগে
    const ffmpegCmd = `ffmpeg -re -threads 1 ${loopCmd}-i "${input}" -vf "scale=720:-2" -c:v libx264 -preset ultrafast -b:v 1000k -maxrate 1000k -bufsize 2000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -f flv ${platform}/${key}`;
    
    console.log("Starting Stable Big-File Stream...");
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
