const express = require('express');
const { exec } = require('child_process');
const app = express();

app.use(express.json());
app.use(express.static('.'));

app.post('/start-stream', (req, res) => {
    const { type, source, platform, key } = req.body;

    if (!source || !platform || !key) {
        return res.send("সবগুলো ঘর পূরণ করুন!");
    }

    let inputSource = source;

    // ইউটিউব লিংক হলে yt-dlp দিয়ে সরাসরি সোর্স বের করা
    if (type === 'link' && (source.includes('youtube.com') || source.includes('youtu.be'))) {
        inputSource = `$(yt-dlp -f "best[ext=mp4]/best" -g ${source})`;
    }

    // CPU চাপ কমাতে -preset ultrafast এবং বিটরেট কমিয়ে দেওয়া হয়েছে
    const ffmpegCmd = `ffmpeg -re -i ${inputSource} -c:v libx264 -preset ultrafast -b:v 1500k -maxrate 1500k -bufsize 3000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 96k -f flv ${platform}/${key}`;

    console.log("Starting stream with command: " + ffmpegCmd);

    const streamProcess = exec(ffmpegCmd);

    streamProcess.stderr.on('data', (data) => {
        console.log(`FFmpeg Log: ${data}`);
    });

    streamProcess.on('exit', (code) => {
        console.log(`Stream stopped with code ${code}`);
    });

    res.send("লাইভ স্ট্রিম শুরু করার অনুরোধ পাঠানো হয়েছে! দয়া করে ইউটিউব স্টুডিও চেক করুন।");
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
