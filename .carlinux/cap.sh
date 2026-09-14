#!/bin/sh
# 从车机 framebuffer /dev/fb0 连续采集并编码为 MJPEG
# 用法: cap.sh <帧数> <输出文件或 - 表示 stdout>
N="${1:-30}"
OUT="${2:-/tmp/out.mjpeg}"
Q="${3:-6}"
i=0
while [ "$i" -lt "$N" ]; do
    dd if=/dev/fb0 bs=2457600 count=1 2>/dev/null
    i=$((i + 1))
done | /tmp/ffmpeg -hide_banner -loglevel error \
    -f rawvideo -pixel_format bgra -video_size 1024x600 -i pipe:0 \
    -c:v mjpeg -q:v "$Q" -f mjpeg "$OUT"
