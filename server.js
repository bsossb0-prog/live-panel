const express = require('express');
const { exec, spawn } = require('child_process');
const app = express();

app.use(express.json());
app.use(express.static('.'));

let streamProcess = null;

app.post('/start-stream', (req, res) => {
    const { type, source, platform, key } = req.body;

    if (!source || !platform || !key) {
        return res.send("সবগুলো ঘর পূরণ করুন!");
    }

    if (streamProcess) {
        return res.send("একটি স্ট্রিম অলরেডি চলছে!");
    }

    let inputSource = source;
    if (type === 'link' && (source.includes('youtube.com') || source.includes('youtu.be'))) {
        inputSource = `$(yt-dlp -g ${source})`;
    }

    // FFmpeg কমান্ডটি execute করার জন্য spawn ব্যবহার করা হয়েছে যাতে প্রসেসটি ট্র্যাক করা যায়
    const ffmpegCmd = `ffmpeg -re -i ${inputSource} -c:v libx264 -preset veryfast -maxrate 3000k -bufsize 6000k -pix_fmt yuv420p -g 50 -c:a aac -b:a 128k -f flv ${platform}/${key}`;
    
    streamProcess = spawn('/bin/bash', ['-c', ffmpegCmd]);

    streamProcess.stderr.on('data', (data) => {
        console.log(`FFmpeg Log: ${data}`);
    });

    streamProcess.on('close', (code) => {
        console.log(`Stream closed with code ${code}`);
        streamProcess = null;
    });

    res.send("সার্ভার কমান্ডটি গ্রহণ করেছে। দয়া করে স্ট্যাটাস চেক করুন।");
});

// লাইভ স্ট্যাটাস চেক করার জন্য নতুন রুট
app.get('/status', (req, res) => {
    if (streamProcess) {
        res.json({ status: 'online' });
    } else {
        res.json({ status: 'offline' });
    }
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
