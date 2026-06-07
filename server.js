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

    // ইউটিউব লিংক সাপোর্ট করার জন্য yt-dlp ব্যবহার
    if (type === 'link' && (source.includes('youtube.com') || source.includes('youtu.be'))) {
        inputSource = `$(yt-dlp -g ${source})`;
    }

    // FFmpeg কমান্ড
    const ffmpegCmd = `ffmpeg -re -i ${inputSource} -c:v libx264 -preset veryfast -maxrate 3000k -bufsize 6000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -f flv ${platform}/${key}`;

    exec(ffmpegCmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
            return;
        }
        console.log(`Stream started successfully`);
    });

    res.send("লাইভ স্ট্রিম শুরু হয়েছে! আপনার ইউটিউব/ফেসবুক চেক করুন।");
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
