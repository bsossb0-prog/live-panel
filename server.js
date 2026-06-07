const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// ফাইল আপলোড করার জন্য সেটিংস
const upload = multer({ dest: 'uploads/' });

app.use(express.static('.'));
app.use(express.json());

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key } = req.body;
    let source = req.body.source;

    if (!platform || !key) return res.send("প্ল্যাটফর্ম এবং কি প্রয়োজন!");

    // ১. যদি ফাইল আপলোড করা হয়
    if (type === 'file' && req.file) {
        source = req.file.path; 
        console.log("File uploaded to: " + source);
    } 
    // ২. যদি ইউটিউব লিংক হয়
    else if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be')))) {
        exec(`yt-dlp -f "best[ext=mp4]/best" -g ${source}`, (error, stdout) => {
            if (error) return res.send("ইউটিউব লিংক সমস্যা!");
            startFfmpeg(stdout.trim(), platform, key);
        });
        return res.send("ইউটিউব থেকে লাইভ শুরু হচ্ছে...");
    } 
    // ৩. সাধারণ লিংকের জন্য
    else if (source) {
        startFfmpeg(source, platform, key);
    } else {
        return res.send("সোর্স পাওয়া যায়নি!");
    }

    res.send("লাইভ শুরু হয়েছে! ইউটিউব/ফেসবুক চেক করুন।");
});

function startFfmpeg(input, platform, key) {
    const ffmpegCmd = `ffmpeg -re -i "${input}" -c:v libx264 -preset ultrafast -b:v 1200k -maxrate 1200k -bufsize 2400k -pix_fmt yuv420p -g 50 -c:a aac -b:a 96k -f flv ${platform}/${key}`;
    
    console.log("Running FFmpeg...");
    const stream = exec(ffmpegCmd);

    stream.stderr.on('data', (data) => console.log(`FFmpeg: ${data}`));
    stream.on('exit', (code) => {
        console.log(`Stream ended with code ${code}`);
        // আপলোড করা ফাইলটি লাইভ শেষ হলে ডিলিট করে দেওয়া হবে যাতে স্টোরেজ খালি থাকে
        if (input.includes('uploads/')) {
            fs.unlinkSync(input);
        }
    });
}

app.listen(3000, () => console.log('Server running on port 3000'));
