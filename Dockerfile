FROM node:22

# সফটওয়্যার ইনস্টল করার জন্য
RUN apt-get update && apt-get install -y ffmpeg python3 python3-pip

# এখানে --break-system-packages যোগ করা হয়েছে যাতে এরর না আসে
RUN pip3 install yt-dlp --break-system-packages

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
