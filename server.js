const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const fs = require('fs');
const app = express();

const upload = multer({ dest: 'uploads/' });

app.use(express.static('.'));
app.use(express.json());

app.post('/start-stream', upload.single('videoFile'), (req, res) => {
    const { type, platform, key } = req.body;
    let source = req.body.source;

    if (!platform || !key) {
        return res.status(400).send("Error: Platform and Key are required!");
    }

    // ১. ফাইল আপলোড হলে
    if (type === 'file' && req.file) {
        source = req.file.path; 
        console.log("File uploaded: " + source);
        startFfmpeg(source, platform, key);
        return res.send("File upload successful! Stream is starting... check YouTube/Facebook.");
    } 
    
    // ২. ইউটিউব লিংক হলে
    if (type === 'link' && (source && (source.includes('youtube.com') || source.includes('youtu.be')))) {
        console.log("Fetching YouTube URL for: " + source);
        
        exec(`yt-dlp -f "best[ext=mp4]/best" -g ${source}`, (error, stdout, stderr) => {
            if (error) {
                console.error("yt-dlp Error: " + stderr);
                // এখানে res.send আগে পাঠানো হয়েছে তাই রিটার্ন করা হয়েছে
                return; 
            }
            const directUrl = stdout.trim();
            console.log("Direct URL found: " + directUrl);
            startFfmpeg(directUrl, platform, key);
        });
        
        return res.send("YouTube link processed! Stream is starting... check your studio.");
    } 
    
    // ৩. সাধারণ সরাসরি লিংকের জন্য
    if (source) {
        startFfmpeg(source, platform, key);
        return res.send("Direct link processed! Stream is starting...");
    }

    return res.status(400).send("Error: No valid video source provided!");
});

function startFfmpeg(input, platform, key) {
    // বিটরেট আরও কমিয়ে দেওয়া হয়েছে যাতে Railway সার্ভার প্রসেসটি কিল না করে
    const ffmpegCmd = `ffmpeg -re -i "${input}" -c:v libx264 -preset ultrafast -b:v 800k -maxrate 800k -bufsize 1600k -pix_fmt yuv420p -g 50 -c:a aac -b:a 64k -f flv ${platform}/${key}`;
    
    console.log("Executing FFmpeg Command: " + ffmpegCmd);
    
    const stream = exec(ffmpegCmd);

    stream.stderr.on('data', (data) => {
        console.log(`FFmpeg Log: ${data}`);
    });

    stream.on('exit', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        if (input.includes('uploads/')) {
            try { fs.unlinkSync(input); } catch (e) {}
        }
    });
}

app.listen(3000, () => console.log('Server running on port 3000'));
