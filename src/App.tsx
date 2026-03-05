/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Download, 
  Play, 
  Scissors, 
  Eraser, 
  Check, 
  X,
  RefreshCw,
  Grid3X3,
  Image as ImageIcon,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Plus,
  Layers,
  LayoutGrid,
  Minimize2,
  Maximize2,
  Zap,
  Percent,
  FlipHorizontal,
  FlipVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';
import confetti from 'canvas-confetti';

interface VideoFrame {
  id: string;
  blob: Blob;
  url: string;
  originalUrl: string;
  gridColors: {r:number, g:number, b:number}[];
}

export default function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [frames, setFrames] = useState<VideoFrame[]>([]);
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fps, setFps] = useState(20);
  const [chromaKey, setChromaKey] = useState({ r: 0, g: 255, b: 0, tolerance: 50, feather: 10 });
  const [watermarkRange, setWatermarkRange] = useState(10);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [isPreviewZoomed, setIsPreviewZoomed] = useState(false);
  const [similarityThreshold, setSimilarityThreshold] = useState(100);
  const [exportSize, setExportSize] = useState<{width: number, height: number} | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationIndex, setAnimationIndex] = useState(0);
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [isUpdatingPreview, setIsUpdatingPreview] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  
  // 新增：精灵图合并状态
  const [spriteColumns, setSpriteColumns] = useState(10);
  const [spriteSheetUrl, setSpriteSheetUrl] = useState<string>('');
  const [isGeneratingSprite, setIsGeneratingSprite] = useState(false);
  const [spritePreviewMode, setSpritePreviewMode] = useState<'fit' | 'actual'>('fit');
  
  // 新增：图像压缩状态
  const [compressionSourceUrl, setCompressionSourceUrl] = useState<string>('');
  const [compressedUrl, setCompressedUrl] = useState<string>('');
  const [compressionRatio, setCompressionRatio] = useState(0.5);
  const [isCompressing, setIsCompressing] = useState(false);
  const [originalDimensions, setOriginalDimensions] = useState<{width: number, height: number} | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 当参数改变时，自动更新预览图
  useEffect(() => {
    if (frames.length > 0) {
      const timer = setTimeout(() => {
        updatePreview();
      }, 300); // 防抖处理
      return () => clearTimeout(timer);
    }
  }, [chromaKey, watermarkRange, previewFrameIndex, frames]);

  // 当相似度滑块改变时，动态更新选择状态
  useEffect(() => {
    if (frames.length < 2) return;
    
    const newSelected = new Set<string>();
    newSelected.add(frames[0].id); // 第一帧总是保留
    
    for (let i = 1; i < frames.length; i++) {
      const g1 = frames[i-1].gridColors;
      const g2 = frames[i].gridColors;
      
      if (!g1 || !g2) {
        newSelected.add(frames[i].id);
        continue;
      }

      // 计算网格颜色差异的平均值
      let totalDiff = 0;
      for (let j = 0; j < g1.length; j++) {
        totalDiff += Math.sqrt(
          Math.pow(g1[j].r - g2[j].r, 2) + 
          Math.pow(g1[j].g - g2[j].g, 2) + 
          Math.pow(g1[j].b - g2[j].b, 2)
        );
      }
      const avgDiff = totalDiff / g1.length;
      
      // 映射相似度：使用平方根让高相似度区间更平滑
      const normalizedDiff = avgDiff / 441.67; 
      const similarity = 100 * (1 - Math.pow(normalizedDiff, 0.3));
      
      if (similarity <= similarityThreshold) {
        newSelected.add(frames[i].id);
      }
    }
    setSelectedFrameIds(newSelected);
  }, [similarityThreshold, frames]);

  // 动画预览逻辑
  useEffect(() => {
    let timer: any;
    if (isAnimating && selectedFrameIds.size > 0) {
      const selectedFrames = frames.filter(f => selectedFrameIds.has(f.id));
      timer = setInterval(() => {
        setAnimationIndex(prev => (prev + 1) % selectedFrames.length);
      }, 1000 / fps);
    } else {
      setAnimationIndex(0);
    }
    return () => clearInterval(timer);
  }, [isAnimating, selectedFrameIds, frames, fps]);

  // 清理旧的 URL
  useEffect(() => {
    return () => {
      frames.forEach(f => {
        if (f.url && f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
        if (f.originalUrl && f.originalUrl.startsWith('blob:')) URL.revokeObjectURL(f.originalUrl);
      });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, []);

  // 视频循环播放逻辑
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    const handleTimeUpdate = () => {
      // 只有在播放状态下才强制循环
      if (!video.paused) {
        if (video.currentTime >= endTime) {
          video.currentTime = startTime;
        }
        if (video.currentTime < startTime) {
          video.currentTime = startTime;
        }
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [startTime, endTime, videoUrl]);

  // 处理文件上传
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setFrames([]);
      setSelectedFrameIds(new Set());
      setProgress(0);

      // 获取视频时长
      const tempVideo = document.createElement('video');
      tempVideo.src = URL.createObjectURL(file);
      tempVideo.onloadedmetadata = () => {
        setVideoDuration(tempVideo.duration);
        setStartTime(0);
        setEndTime(tempVideo.duration);
        URL.revokeObjectURL(tempVideo.src);
      };
    }
  };

  // 提取视频帧
  const extractFrames = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setIsExtracting(true);
    setFrames([]);
    setSelectedFrameIds(new Set());
    setPreviewFrameIndex(0);
    setProgress(0);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) return;

    // 设置画布尺寸
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const duration = endTime - startTime;
    if (isNaN(duration) || duration <= 0) {
      setIsExtracting(false);
      return;
    }

    const totalFrames = Math.floor(duration * fps);
    const interval = 1 / fps;

    const extracted: VideoFrame[] = [];
    const newSelectedIds = new Set<string>();

    const getGridColors = (data: Uint8ClampedArray, width: number, height: number) => {
      const gridSize = 4; // 4x4 网格
      const cellW = Math.floor(width / gridSize);
      const cellH = Math.floor(height / gridSize);
      const colors: {r:number, g:number, b:number}[] = [];

      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          let r = 0, g = 0, b = 0, count = 0;
          const startX = col * cellW;
          const startY = row * cellH;
          
          for (let y = startY; y < startY + cellH; y += 4) {
            for (let x = startX; x < startX + cellW; x += 4) {
              const i = (y * width + x) * 4;
              r += data[i];
              g += data[i + 1];
              b += data[i + 2];
              count++;
            }
          }
          colors.push({ r: r / count, g: g / count, b: b / count });
        }
      }
      return colors;
    };

    try {
      for (let i = 0; i < totalFrames; i++) {
        const targetTime = Math.min(startTime + i * interval, videoDuration - 0.05);
        video.currentTime = targetTime;
        
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            resolve(null);
          }, 1500);

          const onSeeked = () => {
            clearTimeout(timeout);
            video.removeEventListener('seeked', onSeeked);
            resolve(null);
          };
          video.addEventListener('seeked', onSeeked);
        });

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const gridColors = getGridColors(imageData.data, canvas.width, canvas.height);

        const blob = await new Promise<Blob | null>((resolve) => 
          canvas.toBlob((b) => resolve(b), 'image/png')
        );

        if (blob) {
          const url = URL.createObjectURL(blob);
          const id = Math.random().toString(36).substr(2, 9);
          extracted.push({
            id,
            blob,
            url,
            originalUrl: url,
            gridColors
          });
          newSelectedIds.add(id);
        }
        
        setProgress(Math.round(((i + 1) / totalFrames) * 100));
        await new Promise(r => setTimeout(r, 10));
      }

      setFrames(extracted);
      setSelectedFrameIds(newSelectedIds);
      setSimilarityThreshold(100);
    } catch (error) {
      console.error("提取帧时出错:", error);
    } finally {
      setIsExtracting(false);
    }
  };

  // 核心图像处理逻辑
  const processImage = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    const targetR = chromaKey.r;
    const targetG = chromaKey.g;
    const targetB = chromaKey.b;
    const tolerance = chromaKey.tolerance;
    const feather = chromaKey.feather;
    
    const watermarkPxW = Math.floor(width * (watermarkRange / 100));
    const watermarkPxH = Math.floor(height * (watermarkRange / 100));

    // 优化后的色度键算法参数
    const similarity = tolerance / 255;
    const smoothness = feather / 255;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        
        // 水印擦除 (四个角)
        const isTopLeft = x < watermarkPxW && y < watermarkPxH;
        const isTopRight = x > width - watermarkPxW && y < watermarkPxH;
        const isBottomLeft = x < watermarkPxW && y > height - watermarkPxH;
        const isBottomRight = x > width - watermarkPxW && y > height - watermarkPxH;
        
        if (isTopLeft || isTopRight || isBottomLeft || isBottomRight) {
          data[i + 3] = 0;
          continue;
        }

        // 色度键抠图 (优化算法)
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // 计算欧几里得距离并归一化
        const dist = Math.sqrt(
          Math.pow(r - targetR, 2) +
          Math.pow(g - targetG, 2) +
          Math.pow(b - targetB, 2)
        ) / 441.67; // 441.67 是 RGB 空间最大距离 sqrt(255^2 * 3)

        // 软化边缘处理
        let alpha = 255;
        if (dist < similarity) {
          alpha = 0;
        } else if (dist < similarity + smoothness) {
          alpha = ((dist - similarity) / smoothness) * 255;
        }

        data[i + 3] = Math.min(data[i + 3], alpha);

        // 简单的溢色抑制 (Spill Suppression)
        if (alpha < 255) {
          // 如果像素被部分抠除，尝试减少目标颜色的影响
          const factor = alpha / 255;
          // 这里简单处理：如果目标颜色是绿色，减少绿色分量
          if (targetG > targetR && targetG > targetB) {
            data[i + 1] = Math.min(data[i + 1], (data[i] + data[i + 2]) / 2 + (data[i + 1] - (data[i] + data[i + 2]) / 2) * factor);
          } else if (targetR > targetG && targetR > targetB) {
            data[i] = Math.min(data[i], (data[i + 1] + data[i + 2]) / 2 + (data[i] - (data[i + 1] + data[i + 2]) / 2) * factor);
          } else if (targetB > targetR && targetB > targetG) {
            data[i + 2] = Math.min(data[i + 2], (data[i] + data[i + 1]) / 2 + (data[i + 2] - (data[i] + data[i + 1]) / 2) * factor);
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  };

  // 更新预览图
  const updatePreview = async () => {
    if (frames.length === 0 || previewFrameIndex >= frames.length) return;
    setIsUpdatingPreview(true);

    const targetFrame = frames[previewFrameIndex];
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    await new Promise((resolve) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        processImage(ctx, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(URL.createObjectURL(blob));
          }
          resolve(null);
        }, 'image/png');
      };
      img.src = targetFrame.originalUrl;
    });

    setIsUpdatingPreview(false);
  };

  const batchFlip = async (direction: 'horizontal' | 'vertical') => {
    if (frames.length === 0) return;
    
    setIsRemovingBg(true);
    setBatchProgress(0);
    
    const newFrames = [...frames];
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    for (let i = 0; i < newFrames.length; i++) {
      const frame = newFrames[i];
      
      // Flip Original
      const imgOrig = new Image();
      imgOrig.src = frame.originalUrl;
      await new Promise(resolve => imgOrig.onload = resolve);
      canvas.width = imgOrig.width;
      canvas.height = imgOrig.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (direction === 'horizontal') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(0, canvas.height);
        ctx.scale(1, -1);
      }
      ctx.drawImage(imgOrig, 0, 0);
      ctx.restore();
      const blobOrig = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      
      // Flip Current
      const imgCurr = new Image();
      imgCurr.src = frame.url;
      await new Promise(resolve => imgCurr.onload = resolve);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (direction === 'horizontal') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(0, canvas.height);
        ctx.scale(1, -1);
      }
      ctx.drawImage(imgCurr, 0, 0);
      ctx.restore();
      const blobCurr = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));

      if (blobOrig && blobCurr) {
        const newOriginalUrl = URL.createObjectURL(blobOrig);
        const newUrl = URL.createObjectURL(blobCurr);
        
        if (frame.originalUrl.startsWith('blob:')) URL.revokeObjectURL(frame.originalUrl);
        if (frame.url.startsWith('blob:')) URL.revokeObjectURL(frame.url);
        
        newFrames[i] = {
          ...frame,
          originalUrl: newOriginalUrl,
          url: newUrl,
          blob: blobCurr
        };
      }
      setBatchProgress(Math.round(((i + 1) / newFrames.length) * 100));
    }

    setFrames(newFrames);
    setIsRemovingBg(false);
    setBatchProgress(0);
    updatePreview();
  };

  // 批量抠除背景逻辑
  const applyChromaKey = async () => {
    if (frames.length === 0) return;
    setIsRemovingBg(true);
    setBatchProgress(0);

    const updatedFrames: VideoFrame[] = [];
    
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const processedFrame = await new Promise<VideoFrame>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            resolve(frame);
            return;
          }

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          processImage(ctx, canvas.width, canvas.height);

          canvas.toBlob((blob) => {
            if (blob) {
              const url = URL.createObjectURL(blob);
              if (frame.url !== frame.originalUrl) URL.revokeObjectURL(frame.url);
              resolve({ ...frame, blob, url });
            } else {
              resolve(frame);
            }
          }, 'image/png');
        };
        img.src = frame.originalUrl;
      });
      
      updatedFrames.push(processedFrame);
      setBatchProgress(Math.round(((i + 1) / frames.length) * 100));
    }

    setFrames(updatedFrames);
    setIsRemovingBg(false);
    setBatchProgress(0);
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.6 }
    });
  };

  // 重置为原始帧
  const resetFrames = () => {
    setFrames(frames.map(f => {
      if (f.url !== f.originalUrl) URL.revokeObjectURL(f.url);
      return { ...f, url: f.originalUrl };
    }));
  };

  // 切换帧选择状态
  const toggleFrameSelection = (id: string) => {
    const newSelected = new Set(selectedFrameIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedFrameIds(newSelected);
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedFrameIds.size === frames.length) {
      setSelectedFrameIds(new Set());
    } else {
      setSelectedFrameIds(new Set(frames.map(f => f.id)));
    }
  };

  // 导出为 ZIP
  const exportAsZip = async () => {
    const zip = new JSZip();
    const folder = zip.folder("sequence_frames");
    
    const selectedFrames = frames.filter(f => selectedFrameIds.has(f.id));
    
    const resizeCanvas = document.createElement('canvas');
    const resizeCtx = resizeCanvas.getContext('2d');

    for (let i = 0; i < selectedFrames.length; i++) {
      const frame = selectedFrames[i];
      const fileName = `frame_${i.toString().padStart(4, '0')}.png`;
      
      if (exportSize && resizeCtx) {
        // 需要调整大小
        const blob = await new Promise<Blob | null>((resolve) => {
          const img = new Image();
          img.onload = () => {
            resizeCanvas.width = exportSize.width;
            resizeCanvas.height = exportSize.height;
            resizeCtx.clearRect(0, 0, exportSize.width, exportSize.height);
            resizeCtx.drawImage(img, 0, 0, exportSize.width, exportSize.height);
            resizeCanvas.toBlob(resolve, 'image/png');
          };
          img.src = frame.url;
        });
        if (blob) folder?.file(fileName, blob);
      } else {
        // 原始大小
        folder?.file(fileName, frame.blob);
      }
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = "video_sequence.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 生成精灵图
  const generateSpriteSheet = async () => {
    const selectedFrames = frames.filter(f => selectedFrameIds.has(f.id));
    if (selectedFrames.length === 0) return;

    setIsGeneratingSprite(true);
    
    // 获取第一帧的尺寸作为基准
    const firstFrame = selectedFrames[0];
    const img = new Image();
    img.src = firstFrame.url;
    
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    const frameWidth = exportSize ? exportSize.width : img.width;
    const frameHeight = exportSize ? exportSize.height : img.height;
    
    const cols = Math.min(spriteColumns, selectedFrames.length);
    const rows = Math.ceil(selectedFrames.length / cols);
    
    const canvas = document.createElement('canvas');
    canvas.width = cols * frameWidth;
    canvas.height = rows * frameHeight;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) return;

    for (let i = 0; i < selectedFrames.length; i++) {
      const frame = selectedFrames[i];
      const frameImg = new Image();
      frameImg.src = frame.url;
      
      await new Promise((resolve) => {
        frameImg.onload = resolve;
      });
      
      const x = (i % cols) * frameWidth;
      const y = Math.floor(i / cols) * frameHeight;
      
      ctx.drawImage(frameImg, x, y, frameWidth, frameHeight);
    }
    
    const url = canvas.toDataURL('image/png');
    setSpriteSheetUrl(url);
    setIsGeneratingSprite(false);
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  const downloadSpriteSheet = () => {
    if (!spriteSheetUrl) return;
    const link = document.createElement('a');
    link.href = spriteSheetUrl;
    link.download = `spritesheet_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // 图像压缩逻辑
  const compressImage = async () => {
    if (!compressionSourceUrl) return;
    setIsCompressing(true);
    
    const img = new Image();
    img.src = compressionSourceUrl;
    
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 计算压缩后的尺寸
    const targetWidth = Math.round(img.width * compressionRatio);
    const targetHeight = Math.round(img.height * compressionRatio);

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    // 优化：注重细节保留的缩放算法
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    
    // 导出为高质量 PNG (如果需要更小的体积可以考虑 JPEG 但 PNG 保留像素细节更好)
    const url = canvas.toDataURL('image/png');
    setCompressedUrl(url);
    setIsCompressing(false);
    
    confetti({
      particleCount: 50,
      spread: 60,
      origin: { y: 0.7 }
    });
  };

  const setCompressionSource = (url: string) => {
    setCompressionSourceUrl(url);
    setCompressedUrl('');
    const img = new Image();
    img.onload = () => {
      setOriginalDimensions({ width: img.width, height: img.height });
    };
    img.src = url;
  };

  const handleCompressionUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCompressionSource(url);
  };

  const downloadCompressedImage = () => {
    if (!compressedUrl) return;
    const link = document.createElement('a');
    link.href = compressedUrl;
    link.download = `compressed_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExternalFramesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFrames: VideoFrame[] = [];
    const newSelectedIds = new Set(selectedFrameIds);

    const fileList = Array.from(files);
    fileList.forEach((file: File, index) => {
      const url = URL.createObjectURL(file);
      const id = `ext-${Date.now()}-${index}`;
      newFrames.push({
        id,
        blob: file,
        url,
        originalUrl: url,
        gridColors: [],
      });
      newSelectedIds.add(id);
    });

    setFrames(prev => [...prev, ...newFrames]);
    setSelectedFrameIds(newSelectedIds);
    
    // 如果是空状态上传，自动切换到第四步
    if (currentStep !== 4) setCurrentStep(4);
  };

  const clearAllFrames = () => {
    frames.forEach(f => {
      if (f.url && f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
      if (f.originalUrl && f.originalUrl.startsWith('blob:')) URL.revokeObjectURL(f.originalUrl);
    });
    setFrames([]);
    setSelectedFrameIds(new Set());
    setSpriteSheetUrl('');
  };

  const steps = [
    { id: 1, name: '视频提取', icon: <Scissors size={18} /> },
    { id: 2, name: '效果处理', icon: <Eraser size={18} /> },
    { id: 3, name: '筛选导出', icon: <Layers size={18} /> },
    { id: 4, name: '合并大图', icon: <LayoutGrid size={18} /> },
    { id: 5, name: '图像压缩', icon: <Zap size={18} /> },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* 页眉 */}
        <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-serif italic tracking-tight mb-2">序列帧工作流</h1>
            <p className="text-xs uppercase tracking-widest opacity-50 font-semibold">从视频到专业游戏素材的一站式处理</p>
          </div>
          
          {/* 步骤指示器 */}
          <nav className="flex items-center bg-white rounded-2xl p-2 shadow-sm border border-black/5 overflow-x-auto max-w-full">
            {steps.map((step, idx) => {
              const isAvailable = step.id === 1 || step.id === 4 || step.id === 5 || frames.length > 0;
              return (
                <React.Fragment key={step.id}>
                  <button
                    onClick={() => setCurrentStep(step.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                      currentStep === step.id 
                        ? 'bg-[#141414] text-white shadow-md' 
                        : isAvailable 
                          ? 'text-black/60 hover:text-black/80 hover:bg-black/5' 
                          : 'text-black/20 cursor-not-allowed opacity-40'
                    }`}
                    disabled={!isAvailable && currentStep !== step.id}
                  >
                    <span className="hidden sm:inline">{step.icon}</span>
                    <span className="text-xs font-bold whitespace-nowrap">{step.name}</span>
                  </button>
                  {idx < steps.length - 1 && (
                    <ChevronRight size={14} className="mx-1 opacity-20 flex-shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </nav>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* 左侧：当前步骤控制区 */}
          <div className="lg:col-span-5 space-y-6">
            <AnimatePresence mode="wait">
              {currentStep === 1 && (
                <motion.section
                  key="step1"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif italic text-xl flex items-center gap-2">
                      <span className="w-8 h-8 rounded-full bg-black text-white text-xs flex items-center justify-center font-sans not-italic">01</span>
                      视频提取
                    </h3>
                  </div>

                  <div className="aspect-video bg-black rounded-2xl overflow-hidden relative group border border-black/5">
                    {videoUrl ? (
                      <video 
                        ref={videoRef}
                        src={videoUrl} 
                        className="w-full h-full object-contain"
                        controls
                        onLoadedMetadata={(e) => {
                          const v = e.currentTarget;
                          setVideoDuration(v.duration);
                          if (endTime === 0 || endTime > v.duration) setEndTime(v.duration);
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-white/30 gap-3">
                        <Play size={48} strokeWidth={1} />
                        <p className="text-xs uppercase tracking-widest">请先上传视频</p>
                      </div>
                    )}
                    
                    <div className="absolute top-4 right-4">
                      <label className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md text-white rounded-full cursor-pointer hover:bg-white/20 transition-all active:scale-95 border border-white/20">
                        <Upload size={16} />
                        <span className="text-xs font-medium">{videoUrl ? '更换视频' : '上传视频'}</span>
                        <input type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
                      </label>
                    </div>
                  </div>

                  {/* 视频截取区间 - 内置进度条样式 */}
                  {videoUrl && (
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center px-1">
                          <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">截取区间</span>
                          <span className="text-[10px] font-mono opacity-60">
                            {startTime.toFixed(2)}s - {endTime.toFixed(2)}s (共 {(endTime - startTime).toFixed(2)}s)
                          </span>
                        </div>
                        
                        <div className="relative h-6 flex items-center group/range">
                          {/* 背景轨道 */}
                          <div className="absolute w-full h-1.5 bg-black/5 rounded-full overflow-hidden">
                            {/* 选中区间高亮 */}
                            <div 
                              className="absolute h-full bg-black"
                              style={{ 
                                left: `${(startTime / videoDuration) * 100}%`, 
                                width: `${((endTime - startTime) / videoDuration) * 100}%` 
                              }}
                            />
                          </div>
                          
                          {/* 双向 Range Input (叠加层) */}
                          <input 
                            type="range" 
                            min="0" 
                            max={videoDuration} 
                            step="0.01" 
                            value={startTime}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setStartTime(Math.min(val, endTime - 0.1));
                              if (videoRef.current) videoRef.current.currentTime = val;
                            }}
                            className="absolute w-full h-full opacity-0 cursor-pointer pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto"
                            style={{ zIndex: startTime > videoDuration / 2 ? 30 : 20 }}
                          />
                          <input 
                            type="range" 
                            min="0" 
                            max={videoDuration} 
                            step="0.01" 
                            value={endTime}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setEndTime(Math.max(val, startTime + 0.1));
                              if (videoRef.current) videoRef.current.currentTime = val;
                            }}
                            className="absolute w-full h-full opacity-0 cursor-pointer pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-moz-range-thumb]:pointer-events-auto"
                            style={{ zIndex: startTime > videoDuration / 2 ? 20 : 30 }}
                          />

                          {/* 视觉滑块 (Handles) */}
                          <div 
                            className="absolute w-4 h-4 bg-white border-2 border-black rounded-full shadow-sm pointer-events-none z-10 -ml-2"
                            style={{ left: `${(startTime / videoDuration) * 100}%` }}
                          />
                          <div 
                            className="absolute w-4 h-4 bg-white border-2 border-black rounded-full shadow-sm pointer-events-none z-10 -ml-2"
                            style={{ left: `${(endTime / videoDuration) * 100}%` }}
                          />
                        </div>
                        <p className="text-[9px] text-center opacity-30 italic">拖动滑块调整开始和结束时间，视频将在此区间内循环播放</p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-end">
                          <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">提取频率 (FPS)</label>
                          <span className="text-xs font-mono">{fps} 帧/秒</span>
                        </div>
                        <input 
                          type="range" 
                          min="1" 
                          max="60" 
                          value={fps}
                          onChange={(e) => setFps(parseInt(e.target.value))}
                          className="w-full accent-[#141414]"
                        />
                        <p className="text-[10px] opacity-40">预计提取总数: {Math.floor((endTime - startTime) * fps)} 帧</p>
                      </div>

                      <button 
                        onClick={extractFrames}
                        disabled={isExtracting}
                        className="w-full flex items-center justify-center gap-2 py-4 bg-[#141414] text-white rounded-2xl disabled:opacity-20 disabled:cursor-not-allowed hover:bg-opacity-90 transition-all font-semibold shadow-lg"
                      >
                        {isExtracting ? (
                          <>
                            <RefreshCw size={18} className="animate-spin" />
                            <span>正在提取 {Math.round(progress)}%</span>
                          </>
                        ) : (
                          <>
                            <Scissors size={18} />
                            <span>从区间提取序列帧</span>
                          </>
                        )}
                      </button>

                      {frames.length > 0 && !isExtracting && (
                        <button 
                          onClick={() => setCurrentStep(2)}
                          className="w-full flex items-center justify-center gap-2 py-3 bg-black/5 text-black rounded-2xl hover:bg-black/10 transition-all font-medium text-sm"
                        >
                          <span>下一步：效果处理</span>
                          <ArrowRight size={16} />
                        </button>
                      )}
                    </div>
                  )}

                  {!videoUrl && (
                    <div className="py-12 text-center border-2 border-dashed border-black/5 rounded-3xl opacity-30">
                      <p className="text-xs uppercase tracking-widest">请先上传视频以开始</p>
                    </div>
                  )}
                </motion.section>
              )}

              {currentStep === 2 && (
                <motion.section
                  key="step2"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif italic text-xl flex items-center gap-2">
                      <span className="w-8 h-8 rounded-full bg-black text-white text-xs flex items-center justify-center font-sans not-italic">02</span>
                      效果处理
                    </h3>
                    <button 
                      onClick={applyChromaKey}
                      disabled={frames.length === 0 || isRemovingBg}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all text-xs font-semibold disabled:opacity-20 shadow-md"
                    >
                      {isRemovingBg ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          <span>处理中 {batchProgress}%</span>
                        </>
                      ) : (
                        <>
                          <Eraser size={14} />
                          <span>批量应用到所有帧</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">效果预览 (帧 #{previewFrameIndex + 1})</label>
                      </div>
                      <div 
                        onClick={() => setIsPreviewZoomed(true)}
                        className="aspect-video bg-black rounded-xl overflow-hidden checkerboard relative border border-black/5 cursor-zoom-in group"
                      >
                        {previewUrl ? (
                          <img src={previewUrl} className="w-full h-full object-contain transition-transform group-hover:scale-105" alt="Preview" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-black/10">
                            <ImageIcon size={24} />
                          </div>
                        )}
                        {isUpdatingPreview && (
                          <div className="absolute inset-0 bg-white/50 backdrop-blur-[2px] flex items-center justify-center">
                            <RefreshCw size={24} className="animate-spin text-[#141414]" />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">目标颜色</label>
                        <div className="flex items-center gap-3">
                          <input 
                            type="color" 
                            value={`#${chromaKey.r.toString(16).padStart(2,'0')}${chromaKey.g.toString(16).padStart(2,'0')}${chromaKey.b.toString(16).padStart(2,'0')}`}
                            onChange={(e) => {
                              const hex = e.target.value;
                              const r = parseInt(hex.slice(1, 3), 16);
                              const g = parseInt(hex.slice(3, 5), 16);
                              const b = parseInt(hex.slice(5, 7), 16);
                              setChromaKey({ ...chromaKey, r, g, b });
                            }}
                            className="w-10 h-10 rounded-lg cursor-pointer border-none p-0 overflow-hidden shadow-sm"
                          />
                          <div className="flex-1 text-[10px] font-mono opacity-60">
                            RGB({chromaKey.r}, {chromaKey.g}, {chromaKey.b})
                          </div>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">容差范围 ({Math.round(chromaKey.tolerance / 2.55)}%)</label>
                        <input 
                          type="range" min="1" max="255" value={chromaKey.tolerance}
                          onChange={(e) => setChromaKey({ ...chromaKey, tolerance: parseInt(e.target.value) })}
                          className="w-full accent-[#141414]"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">边缘羽化 ({Math.round(chromaKey.feather / 2.55)}%)</label>
                        <input 
                          type="range" min="0" max="100" value={chromaKey.feather}
                          onChange={(e) => setChromaKey({ ...chromaKey, feather: parseInt(e.target.value) })}
                          className="w-full accent-[#141414]"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">水印擦除 ({watermarkRange}%)</label>
                        <input 
                          type="range" min="0" max="50" value={watermarkRange}
                          onChange={(e) => setWatermarkRange(parseInt(e.target.value))}
                          className="w-full accent-[#141414]"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">输出尺寸</label>
                      <div className="flex flex-wrap gap-2">
                        {[48, 64, 96, 128, 256].map(size => (
                          <button 
                            key={size}
                            onClick={() => setExportSize({ width: size, height: size })}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                              exportSize?.width === size 
                                ? 'bg-[#141414] text-white border-[#141414]' 
                                : 'bg-white text-black/60 border-black/10 hover:border-black/30'
                            }`}
                          >
                            {size}px
                          </button>
                        ))}
                        <button 
                          onClick={() => setExportSize(null)}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${
                            exportSize === null 
                              ? 'bg-[#141414] text-white border-[#141414]' 
                              : 'bg-white text-black/60 border-black/10 hover:border-black/30'
                          }`}
                        >
                          原始尺寸
                        </button>
                      </div>
                      {exportSize && (
                        <div className="flex gap-2 mt-2">
                          <input 
                            type="number" 
                            value={exportSize.width} 
                            onChange={(e) => setExportSize({...exportSize, width: parseInt(e.target.value)})}
                            className="w-20 px-2 py-1 text-xs border rounded-md"
                            placeholder="宽"
                          />
                          <input 
                            type="number" 
                            value={exportSize.height} 
                            onChange={(e) => setExportSize({...exportSize, height: parseInt(e.target.value)})}
                            className="w-20 px-2 py-1 text-xs border rounded-md"
                            placeholder="高"
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">镜像翻转 (批量)</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                          onClick={() => batchFlip('horizontal')}
                          disabled={frames.length === 0 || isRemovingBg}
                          className="flex items-center justify-center gap-2 py-2.5 bg-black/5 text-black rounded-xl hover:bg-black/10 transition-all text-xs font-bold disabled:opacity-20"
                        >
                          <FlipHorizontal size={14} />
                          <span>左右翻转</span>
                        </button>
                        <button 
                          onClick={() => batchFlip('vertical')}
                          disabled={frames.length === 0 || isRemovingBg}
                          className="flex items-center justify-center gap-2 py-2.5 bg-black/5 text-black rounded-xl hover:bg-black/10 transition-all text-xs font-bold disabled:opacity-20"
                        >
                          <FlipVertical size={14} />
                          <span>上下翻转</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button 
                        onClick={() => setCurrentStep(1)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-black/5 text-black rounded-2xl hover:bg-black/10 transition-all font-medium text-sm"
                      >
                        <ChevronLeft size={16} />
                        <span>上一步</span>
                      </button>
                      <button 
                        onClick={() => setCurrentStep(3)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-black text-white rounded-2xl hover:bg-opacity-90 transition-all font-medium text-sm shadow-md"
                      >
                        <span>下一步：筛选导出</span>
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </motion.section>
              )}

              {currentStep === 3 && (
                <motion.section
                  key="step3"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif italic text-xl flex items-center gap-2">
                      <span className="w-8 h-8 rounded-full bg-black text-white text-xs flex items-center justify-center font-sans not-italic">03</span>
                      筛选导出
                    </h3>
                  </div>

                  <div className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">相似度过滤 (去重)</label>
                        <span className="text-xs font-mono">{similarityThreshold.toFixed(2)}%</span>
                      </div>
                      <input 
                        type="range" min="50" max="100" step="0.01" value={similarityThreshold}
                        onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
                        className="w-full accent-[#141414]"
                      />
                      <div className="flex justify-between text-[10px] opacity-40">
                        <span>保留所有帧</span>
                        <span>仅保留变化剧烈的帧</span>
                      </div>
                      <div className="bg-black/5 rounded-2xl p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <LayoutGrid size={20} className="opacity-40" />
                          <div>
                            <p className="text-xs font-bold">当前选择</p>
                            <p className="text-[10px] opacity-50">已选中 {selectedFrameIds.size} / {frames.length} 帧</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setSelectedFrameIds(new Set(frames.map(f => f.id)))}
                            className="text-[10px] font-bold underline underline-offset-4"
                          >
                            全选
                          </button>
                          <button 
                            onClick={() => setSelectedFrameIds(new Set())}
                            className="text-[10px] font-bold underline underline-offset-4"
                          >
                            清空
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <button 
                        onClick={exportAsZip}
                        disabled={selectedFrameIds.size === 0}
                        className="w-full flex items-center justify-center gap-2 py-4 bg-[#141414] text-white rounded-2xl disabled:opacity-20 disabled:cursor-not-allowed hover:bg-opacity-90 transition-all font-semibold shadow-lg"
                      >
                        <Download size={18} />
                        <span>下载 ZIP 序列包</span>
                      </button>
                      
                      <button 
                        onClick={() => setCurrentStep(4)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all font-medium text-sm shadow-md"
                      >
                        <span>下一步：合并大图 (Sprite Sheet)</span>
                        <ChevronRight size={16} />
                      </button>

                      <button 
                        onClick={() => setCurrentStep(2)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-black/5 text-black rounded-2xl hover:bg-black/10 transition-all font-medium text-sm"
                      >
                        <ChevronLeft size={16} />
                        <span>上一步：效果处理</span>
                      </button>
                    </div>
                  </div>
                </motion.section>
              )}

              {currentStep === 4 && (
                <motion.section
                  key="step4"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif italic text-xl flex items-center gap-2">
                      <span className="w-8 h-8 rounded-full bg-black text-white text-xs flex items-center justify-center font-sans not-italic">04</span>
                      大图合并
                    </h3>
                    <div className="flex items-center gap-2">
                      {frames.length > 0 && (
                        <button 
                          onClick={clearAllFrames}
                          className="flex items-center gap-2 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-[10px] font-bold transition-all border border-red-100"
                        >
                          <Eraser size={14} />
                          <span>清空全部</span>
                        </button>
                      )}
                      <label className="cursor-pointer flex items-center gap-2 px-3 py-1.5 bg-black/5 hover:bg-black/10 rounded-xl text-[10px] font-bold transition-all border border-black/5">
                        <Plus size={14} />
                        <span>添加外部帧</span>
                        <input 
                          type="file" 
                          multiple 
                          accept="image/*" 
                          className="hidden" 
                          onChange={handleExternalFramesUpload}
                        />
                      </label>
                    </div>
                  </div>

                  {frames.length === 0 ? (
                    <div className="py-12 border-2 border-dashed border-black/10 rounded-3xl flex flex-col items-center justify-center gap-4 bg-black/[0.02]">
                      <div className="w-16 h-16 rounded-full bg-black/5 flex items-center justify-center text-black/20">
                        <Upload size={32} />
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-sm">暂无序列帧</p>
                        <p className="text-xs opacity-40 mt-1">上传多张图片即可开始合并</p>
                      </div>
                      <label className="cursor-pointer px-6 py-2.5 bg-black text-white rounded-2xl text-xs font-bold hover:bg-opacity-90 transition-all shadow-md">
                        <span>立即上传</span>
                        <input 
                          type="file" 
                          multiple 
                          accept="image/*" 
                          className="hidden" 
                          onChange={handleExternalFramesUpload}
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">每行帧数 (列数)</label>
                        <input 
                          type="number" 
                          min="1" 
                          max={Math.max(1, selectedFrameIds.size)}
                          value={spriteColumns}
                          onChange={(e) => setSpriteColumns(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full px-4 py-2 bg-black/5 rounded-xl text-sm font-mono border-none focus:ring-2 focus:ring-black/10"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">预计行数</label>
                        <div className="w-full px-4 py-2 bg-black/5 rounded-xl text-sm font-mono opacity-50">
                          {Math.ceil(selectedFrameIds.size / spriteColumns)} 行
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">镜像翻转 (批量)</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                          onClick={() => batchFlip('horizontal')}
                          disabled={frames.length === 0 || isRemovingBg}
                          className="flex items-center justify-center gap-2 py-2.5 bg-black/5 text-black rounded-xl hover:bg-black/10 transition-all text-xs font-bold disabled:opacity-20"
                        >
                          <FlipHorizontal size={14} />
                          <span>左右翻转</span>
                        </button>
                        <button 
                          onClick={() => batchFlip('vertical')}
                          disabled={frames.length === 0 || isRemovingBg}
                          className="flex items-center justify-center gap-2 py-2.5 bg-black/5 text-black rounded-xl hover:bg-black/10 transition-all text-xs font-bold disabled:opacity-20"
                        >
                          <FlipVertical size={14} />
                          <span>上下翻转</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">合并预览</label>
                        {spriteSheetUrl && (
                          <div className="flex bg-black/5 p-1 rounded-lg gap-1">
                            <button 
                              onClick={() => setSpritePreviewMode('fit')}
                              className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${spritePreviewMode === 'fit' ? 'bg-white shadow-sm text-black' : 'text-black/40 hover:text-black/60'}`}
                            >
                              <Minimize2 size={12} />
                              全图显示
                            </button>
                            <button 
                              onClick={() => setSpritePreviewMode('actual')}
                              className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${spritePreviewMode === 'actual' ? 'bg-white shadow-sm text-black' : 'text-black/40 hover:text-black/60'}`}
                            >
                              <Maximize2 size={12} />
                              实际显示
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="aspect-square bg-black rounded-2xl overflow-auto checkerboard border border-black/5 p-4 flex items-center justify-center min-h-[200px] relative">
                        {spriteSheetUrl ? (
                          <img 
                            src={spriteSheetUrl} 
                            className={`${spritePreviewMode === 'fit' ? 'max-w-full max-h-full object-contain' : 'max-w-none'} shadow-2xl transition-all duration-300`} 
                            alt="Sprite Sheet" 
                            referrerPolicy="no-referrer" 
                          />
                        ) : (
                          <div className="text-center space-y-2 opacity-20">
                            <LayoutGrid size={48} className="mx-auto" />
                            <p className="text-[10px] uppercase tracking-widest">点击下方按钮生成</p>
                          </div>
                        )}
                        {isGeneratingSprite && (
                          <div className="absolute inset-0 bg-white/50 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
                            <RefreshCw size={32} className="animate-spin text-[#141414]" />
                            <span className="text-xs font-bold uppercase tracking-widest">正在拼合图层...</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <button 
                        onClick={generateSpriteSheet}
                        disabled={selectedFrameIds.size === 0 || isGeneratingSprite}
                        className="w-full flex items-center justify-center gap-2 py-4 bg-[#141414] text-white rounded-2xl disabled:opacity-20 disabled:cursor-not-allowed hover:bg-opacity-90 transition-all font-semibold shadow-lg"
                      >
                        <Grid3X3 size={18} />
                        <span>生成精灵大图 (Sprite Sheet)</span>
                      </button>

                      {spriteSheetUrl && (
                        <div className="space-y-3">
                          <button 
                            onClick={downloadSpriteSheet}
                            className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all font-semibold shadow-lg"
                          >
                            <Download size={18} />
                            <span>下载合并后的大图</span>
                          </button>
                          
                          <button 
                            onClick={() => setCurrentStep(5)}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-black text-white rounded-2xl hover:bg-opacity-90 transition-all font-medium text-sm shadow-md"
                          >
                            <span>下一步：图像压缩</span>
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      )}

                      <button 
                        onClick={() => setCurrentStep(3)}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-black/5 text-black rounded-2xl hover:bg-black/10 transition-all font-medium text-sm"
                      >
                        <ChevronLeft size={16} />
                        <span>上一步：筛选导出</span>
                      </button>
                    </div>
                  </div>
                )}
              </motion.section>
            )}

            {currentStep === 5 && (
              <motion.section
                key="step5"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-serif italic text-xl flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-black text-white text-xs flex items-center justify-center font-sans not-italic">05</span>
                    图像压缩
                  </h3>
                </div>

                <div className="space-y-6">
                  {!compressionSourceUrl ? (
                    <div className="py-12 border-2 border-dashed border-black/10 rounded-3xl flex flex-col items-center justify-center gap-4 bg-black/[0.02]">
                      <div className="w-16 h-16 rounded-full bg-black/5 flex items-center justify-center text-black/20">
                        <ImageIcon size={32} />
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-sm">上传需要压缩的图像</p>
                        <p className="text-xs opacity-40 mt-1">支持 PNG/JPG，注重细节保留</p>
                      </div>
                      <label className="cursor-pointer px-6 py-2.5 bg-black text-white rounded-2xl text-xs font-bold hover:bg-opacity-90 transition-all shadow-md">
                        <span>选择文件</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          onChange={handleCompressionUpload}
                        />
                      </label>
                      {spriteSheetUrl && (
                        <button 
                          onClick={() => setCompressionSource(spriteSheetUrl)}
                          className="text-[10px] font-bold underline underline-offset-4 opacity-40 hover:opacity-100 transition-all"
                        >
                          使用刚才生成的精灵图
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="space-y-4">
                        <div className="flex justify-between items-end">
                          <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">压缩比例 (尺寸缩放)</label>
                          <span className="text-xs font-mono">{(compressionRatio * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <Percent size={16} className="opacity-20" />
                          <input 
                            type="range" min="0.1" max="1" step="0.05" value={compressionRatio}
                            onChange={(e) => setCompressionRatio(parseFloat(e.target.value))}
                            className="flex-1 accent-[#141414]"
                          />
                        </div>
                        <div className="flex justify-between text-[9px] opacity-30 uppercase tracking-tighter">
                          <span>极小尺寸 (10%)</span>
                          <span>原始尺寸 (100%)</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">原始预览</label>
                          <div className="aspect-square bg-black rounded-2xl overflow-hidden checkerboard border border-black/5 flex items-center justify-center relative">
                            <img src={compressionSourceUrl} className="max-w-full max-h-full object-contain" alt="Original" referrerPolicy="no-referrer" />
                            <div className="absolute top-2 left-2 px-2 py-1 bg-black/50 backdrop-blur-md text-white text-[8px] rounded-md font-bold uppercase">Original</div>
                            {originalDimensions && (
                              <div className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 backdrop-blur-md text-white text-[9px] rounded-md font-mono">
                                {originalDimensions.width} × {originalDimensions.height}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] uppercase tracking-widest font-bold opacity-40">压缩后预览</label>
                          <div className="aspect-square bg-black rounded-2xl overflow-hidden checkerboard border border-black/5 flex items-center justify-center relative">
                            {compressedUrl ? (
                              <img src={compressedUrl} className="max-w-full max-h-full object-contain" alt="Compressed" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="text-white/10 flex flex-col items-center gap-2">
                                <Zap size={24} strokeWidth={1} />
                                <p className="text-[8px] uppercase tracking-widest">等待压缩...</p>
                              </div>
                            )}
                            <div className="absolute top-2 left-2 px-2 py-1 bg-emerald-500/80 backdrop-blur-md text-white text-[8px] rounded-md font-bold uppercase">Compressed</div>
                            {originalDimensions && (
                              <div className="absolute bottom-2 right-2 px-2 py-1 bg-emerald-500/80 backdrop-blur-md text-white text-[9px] rounded-md font-mono">
                                {Math.round(originalDimensions.width * compressionRatio)} × {Math.round(originalDimensions.height * compressionRatio)}
                                <span className="ml-1 opacity-60">(估算)</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <button 
                          onClick={compressImage}
                          disabled={isCompressing}
                          className="w-full flex items-center justify-center gap-2 py-4 bg-[#141414] text-white rounded-2xl disabled:opacity-20 disabled:cursor-not-allowed hover:bg-opacity-90 transition-all font-semibold shadow-lg"
                        >
                          {isCompressing ? (
                            <>
                              <RefreshCw size={18} className="animate-spin" />
                              <span>正在压缩像素...</span>
                            </>
                          ) : (
                            <>
                              <Zap size={18} />
                              <span>开始细节保留压缩</span>
                            </>
                          )}
                        </button>

                        {compressedUrl && (
                          <button 
                            onClick={downloadCompressedImage}
                            className="w-full flex items-center justify-center gap-2 py-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all font-semibold shadow-lg"
                          >
                            <Download size={18} />
                            <span>下载压缩后的图像</span>
                          </button>
                        )}

                        <div className="flex gap-3">
                          <button 
                            onClick={() => {
                              setCompressionSourceUrl('');
                              setCompressedUrl('');
                            }}
                            className="flex-1 py-3 bg-black/5 text-black rounded-2xl hover:bg-black/10 transition-all font-medium text-sm"
                          >
                            重新上传
                          </button>
                          <button 
                            onClick={() => setCurrentStep(4)}
                            className="flex-1 py-3 bg-black/5 text-black rounded-2xl hover:bg-black/10 transition-all font-medium text-sm"
                          >
                            返回合并大图
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

          {/* 右侧：全局帧列表与实时动画预览 */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            {/* 动画预览区 - 移除 sticky 布局 */}
            <section className="bg-white rounded-3xl p-4 shadow-sm border border-black/5 z-20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-serif italic text-lg flex items-center gap-2">
                  合成预览
                  <span className="text-[9px] font-sans not-italic bg-black/5 px-2 py-0.5 rounded-full opacity-50">
                    {selectedFrameIds.size} 帧
                  </span>
                </h3>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsAnimating(!isAnimating)}
                    disabled={selectedFrameIds.size === 0}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-[10px] font-bold ${
                      isAnimating ? 'bg-red-50 text-red-600' : 'bg-black text-white'
                    }`}
                  >
                    {isAnimating ? <X size={12} /> : <Play size={12} />}
                    {isAnimating ? '停止' : '播放'}
                  </button>
                </div>
              </div>

              <div className="aspect-video max-h-[240px] bg-black rounded-2xl overflow-hidden checkerboard relative border border-black/5 flex items-center justify-center mx-auto">
                {frames.length > 0 ? (
                  <img 
                    src={frames.filter(f => selectedFrameIds.has(f.id))[animationIndex]?.url || frames[0].url} 
                    className="h-full object-contain" 
                    alt="Animation Preview"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="text-white/10 flex flex-col items-center gap-2">
                    <Play size={32} strokeWidth={1} />
                    <p className="text-[9px] uppercase tracking-widest">等待提取...</p>
                  </div>
                )}
                
                {isAnimating && (
                  <div className="absolute bottom-2 left-2 right-2 h-0.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-white"
                      initial={{ width: "0%" }}
                      animate={{ width: `${((animationIndex + 1) / selectedFrameIds.size) * 100}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                )}
              </div>
            </section>

            {/* 帧列表区 - 移除 flex-1 让其根据内容自适应高度 */}
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-black/5">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <h3 className="font-serif italic text-xl">序列帧列表</h3>
                  <button 
                    onClick={() => {
                      if (selectedFrameIds.size === frames.length) {
                        setSelectedFrameIds(new Set());
                      } else {
                        setSelectedFrameIds(new Set(frames.map(f => f.id)));
                      }
                    }}
                    className="px-3 py-1 bg-black/5 hover:bg-black/10 rounded-full text-[10px] font-bold transition-all"
                  >
                    {selectedFrameIds.size === frames.length ? '取消全选' : '全选'}
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    已选中
                  </div>
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold opacity-40">
                    <div className="w-2 h-2 rounded-full bg-black/10"></div>
                    已过滤
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {frames.map((frame, index) => {
                  const isSelected = selectedFrameIds.has(frame.id);
                  return (
                    <motion.div 
                      key={frame.id}
                      layout
                      onClick={() => {
                        const newSelected = new Set(selectedFrameIds);
                        if (isSelected) newSelected.delete(frame.id);
                        else newSelected.add(frame.id);
                        setSelectedFrameIds(newSelected);
                        setPreviewFrameIndex(index);
                      }}
                      className={`group relative aspect-square rounded-2xl overflow-hidden cursor-pointer transition-all border-2 ${
                        isSelected 
                          ? 'border-emerald-500 shadow-lg scale-[0.98]' 
                          : 'border-black/5 opacity-40 grayscale hover:grayscale-0 hover:opacity-100 hover:border-black/20'
                      } ${previewFrameIndex === index ? 'ring-4 ring-emerald-500/20' : ''}`}
                    >
                      <img 
                        src={frame.url} 
                        className="w-full h-full object-cover checkerboard" 
                        alt={`Frame ${index}`}
                        referrerPolicy="no-referrer"
                      />
                      <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                        {isSelected ? (
                          <div className="bg-emerald-500 text-white p-1 rounded-full shadow-lg">
                            <Check size={12} strokeWidth={3} />
                          </div>
                        ) : (
                          <div className="bg-white/80 backdrop-blur-sm text-black p-1 rounded-full shadow-lg">
                            <Plus size={12} strokeWidth={3} />
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-1 left-1 bg-black/50 backdrop-blur-md text-[8px] text-white px-1.5 py-0.5 rounded-md font-mono">
                        #{index + 1}
                      </div>
                    </motion.div>
                  );
                })}
                
                {frames.length === 0 && (
                  <div className="col-span-full py-20 text-center space-y-4 opacity-20">
                    <ImageIcon size={48} className="mx-auto" />
                    <p className="text-xs uppercase tracking-widest font-bold">暂无提取的帧</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>

      {/* 预览放大弹窗 */}
      <AnimatePresence>
        {isPreviewZoomed && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#141414]/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-12"
            onClick={() => setIsPreviewZoomed(false)}
          >
            <button className="absolute top-8 right-8 text-white/50 hover:text-white transition-colors">
              <X size={32} />
            </button>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="w-full h-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img 
                src={previewUrl} 
                className="max-w-full max-h-full object-contain checkerboard rounded-2xl shadow-2xl" 
                alt="Zoomed Preview"
                referrerPolicy="no-referrer"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 用于处理的隐藏画布 */}
      <canvas ref={canvasRef} className="hidden" />

      <style dangerouslySetInnerHTML={{ __html: `
        .checkerboard {
          background-image: linear-gradient(45deg, #f0f0f0 25%, transparent 25%),
            linear-gradient(-45deg, #f0f0f0 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, #f0f0f0 75%),
            linear-gradient(-45deg, transparent 75%, #f0f0f0 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
          background-color: #fff;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0,0,0,0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0,0,0,0.2);
        }
      `}} />
    </div>
  );
}
