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

    let finalInput = source;

    // ইউটিউব লিংক হলে yt-dlp দিয়ে আসল সোর্স বের করা
    if (type === 'link' && (source.includes('youtube.com') || source.includes('youtu.be'))) {
        console.log("Fetching direct URL from YouTube...");
        
        exec(`yt-dlp -f "best[ext=mp4]/best" -g ${source}`, (error, stdout, stderr) => {
            if (error) {
                console.error(`yt-dlp Error: ${error.message}`);
                return res.send("ভিডিওর লিংক খুঁজে পাওয়া যায়নি। অন্য লিংক চেষ্টা করুন।");
            }
            
            finalInput = stdout.trim();
            console.log("Direct URL found, starting FFmpeg...");
            startFfmpeg(finalInput, platform, key);
        });
    } else {
        startFfmpeg(finalInput, platform, key);
    }

    res.send("প্রসেস শুরু হয়েছে! দয়া করে ১-২ মিনিট অপেক্ষা করে ইউটিউব স্টুডিও চেক করুন।");
});

function startFfmpeg(input, platform, key) {
    // CPU লোড কমাতে ultrafast এবং বিটরেট কন্ট্রোল করা হয়েছে
    const ffmpegCmd = `ffmpeg -re -i "${input}" -c:v libx264 -preset ultrafast -b:v 1200k -maxrate 1200k -bufsize 2400k -pix_fmt yuv420p -g 50 -c:a aac -b:a 96k -f flv ${platform}/${key}`;

    console.log("Running Command: " + ffmpegCmd);

    const stream = exec(ffmpegCmd);

    stream.stderr.on('data', (data) => {
        console.log(`FFmpeg Log: ${data}`);
    });

    stream.on('exit', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
    });
}

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
