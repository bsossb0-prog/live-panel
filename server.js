const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

// ১ জিবি আপলোড লিমিট
const upload = multer({ 
    dest: 'uploads/', 
    limits: { fileSize: 1024 * 1024 * 1024 } 
});

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
    res.json({ isActive: activeStream !== null, startTime: streamStartTime });
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
        return res.send("File Uploaded! Starting Stable Stream...");
    } 
    
    // লিংকের অপশনটি রাখা হয়েছে কিন্তু আমরা এখন ফাইল আপলোড ব্যবহার করব
    if (source) {
        startFfmpeg(source, platform, key, loop, mode);
        return res.send("Stream starting...");
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
        // শর্টস মোড: ৭২০x১২৮০ (Stable Vertical)
        scaleFilter = "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280";
    } else {
        // স্ট্যান্ডার্ড মোড: ১২৮০x৭২০ (Stable Horizontal)
        scaleFilter = "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2";
    }
    
    // ⚡ সুপার-স্টেবল সেটিংস: বিটরেট ১০০০k এবং zerolatency ব্যবহার করা হয়েছে
    // এতে র‍্যাম খুব কম খরচ হবে এবং লাইভ ক্র্যাশ করবে না
    const ffmpegCmd = `ffmpeg -re ${loopCmd}-i "${input}" -vf "${scaleFilter}" -c:v libx264 -preset ultrafast -tune zerolatency -b:v 1000k -maxrate 1000k -bufsize 2000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 96k -f flv ${platform}/${key}`;
    
    console.log("Executing Stable Stream...");
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
app.listen(PORT, () => console.log(`Survivor Mode Server running on port ${PORT}`));
