const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });

app.use(express.static('.'));
app.use(express.json());

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key } = req.body;
    let source = req.body.source;

    if (!platform || !key) return res.send("Error: Platform and Key are required!");

    if (type === 'file' && req.file) {
        source = req.file.path; 
    } else if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be')))) {
        // ইউটিউব থেকে সরাসরি লিংক বের করার কমান্ড
        exec(`yt-dlp -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) {
                console.error("yt-dlp Error: " + error);
                return res.send("Error: Could not fetch YouTube video URL.");
            }
            startFfmpeg(stdout.trim(), platform, key);
        });
        return res.send("Process started! Please check your YouTube Studio in 1-2 minutes.");
    } else if (source) {
        startFfmpeg(source, platform, key);
    } else {
        return res.send("Error: No video source provided!");
    }

    res.send("Process started! Please check your YouTube Studio in 1-2 minutes.");
});

function startFfmpeg(input, platform, key) {
    // একদম লো-বিটরেট এবং আল্ট্রাফাস্ট মোড যাতে Railway সার্ভার কিল না করে
    const ffmpegCmd = `ffmpeg -re -i "${input}" -c:v libx264 -preset ultrafast -b:v 800k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p -g 50 -c:a aac -b:a 64k -f flv ${platform}/${key}`;
    
    console.log("Executing: " + ffmpegCmd);
    const stream = exec(ffmpegCmd);

    stream.stderr.on('data', (data) => {
        console.log(`FFmpeg Log: ${data}`); // এই লেখাগুলোই Railway-এর Logs ট্যাবে দেখা যাবে
    });

    stream.on('exit', (code) => {
        console.log(`FFmpeg exited with code ${code}`);
        if (input.includes('uploads/')) fs.unlinkSync(input);
    });
}

app.listen(3000, () => console.log('Server running on port 3000'));
