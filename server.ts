import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Directories for file storage
  const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
  const FRAMES_DIR = path.join(process.cwd(), "data", "frames");
  const AUDIO_DIR = path.join(process.cwd(), "data", "audio");

  // Ensure directories exist
  [UPLOAD_DIR, FRAMES_DIR, AUDIO_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Storage tracking
  const jobs: Record<string, {
    id: string;
    status: "processing" | "completed" | "error";
    progress: number;
    videoPath?: string;
    audioPath?: string;
    frames: string[];
    metadata?: any;
    error?: string;
    logs: string[];
  }> = {};

  const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  });

  const upload = multer({ 
    storage,
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB safety limit for professional assets
  });

  // Check FFmpeg availability
  ffmpeg.getAvailableCodecs((err, codecs) => {
    if (err) {
      console.error("FFmpeg not found - processing will fail:", err.message);
    } else {
      console.log("FFmpeg core engine verified.");
    }
  });

  // API Routes
  // Increased limits for general requests, but multer handles file uploads separately
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Static serving for processed data
  app.use("/data/frames", express.static(FRAMES_DIR));
  app.use("/data/audio", express.static(AUDIO_DIR));
  app.use("/data/uploads", express.static(UPLOAD_DIR));

  app.post("/api/upload", (req, res, next) => {
    console.log(">>> [API] /upload connection established");
    next();
  }, (req, res, next) => {
    upload.single("video")(req, res, (err) => {
      if (err) {
        console.error(">>> [API] Multer/Upload Error:", err);
        return res.status(500).json({ 
          error: "Filesystem Ingestion Failure", 
          details: err.message,
          code: "UPLOAD_BLOCKED"
        });
      }
      next();
    });
  }, (req, res) => {
    console.log(">>> [API] Payload received successfully");
    
    if (!req.file) {
      console.error(">>> [API] Multer completed but req.file is empty");
      return res.status(400).json({ error: "Empty payload rejected" });
    }

    const jobId = uuidv4();
    const filename = req.file.filename;
    const absolutePath = req.file.path;
    const videoId = path.parse(filename).name;

    console.log(`>>> [Job ${jobId}] Initializing for ${filename}`);

    jobs[jobId] = {
      id: jobId,
      status: "processing",
      progress: 1,
      videoPath: `/data/uploads/${filename}`,
      frames: [],
      logs: ["Job initialized", "Storage synchronization finalized"],
    };

    res.json({ jobId });

    // Run background processing
    processVideo(jobId, absolutePath, videoId).catch(err => {
      console.error(`>>> [Job ${jobId}] Background Fatal:`, err);
      if (jobs[jobId]) {
        jobs[jobId].status = "error";
        jobs[jobId].error = err.message;
        jobs[jobId].logs.push(`CRITICAL ERROR: ${err.message}`);
      }
    });
  });

  app.get("/api/status/:jobId", (req, res) => {
    const job = jobs[req.params.jobId];
    if (!job) {
      return res.status(404).json({ error: "Job ID not synchronization" });
    }
    res.json(job);
  });

  async function processVideo(jobId: string, inputPath: string, videoId: string) {
    const job = jobs[jobId];
    const log = (msg: string) => {
      console.log(`[Job ${jobId}] ${msg}`);
      job.logs.push(msg);
    };

    log("Starting intelligence extraction pipeline");
    
    const audioFilename = `${videoId}.mp3`;
    const audioOutputPath = path.join(AUDIO_DIR, audioFilename);
    const framesOutputDir = path.join(FRAMES_DIR, videoId);

    if (!fs.existsSync(framesOutputDir)) {
      fs.mkdirSync(framesOutputDir, { recursive: true });
    }

    try {
      log("Analyzing video metadata...");
      const metadata = await new Promise<any>((resolve) => {
        ffmpeg.ffprobe(inputPath, (err, data) => {
          if (err) {
            log(`Metadata probe warning: ${err.message}`);
            resolve({ format: { duration: 0 }, streams: [] });
          } else {
            resolve(data);
          }
        });
      });
      job.metadata = metadata.format;
      job.progress = 10;
      
      const hasAudio = metadata.streams?.some((s: any) => s.codec_type === "audio");
      log(`Metadata captured. Audio Stream: ${hasAudio ? "Detected" : "None"}. Duration: ${Math.round(metadata.format.duration || 0)}s`);

      log("Spawning extraction engines (Audio + Frames)");
      
      const audioTask = new Promise<void>((resolve, reject) => {
        if (!hasAudio) {
          log("Skipping audio extraction: Source media is silent");
          resolve();
          return;
        }

        ffmpeg(inputPath)
          .noVideo()
          .audioCodec("libmp3lame")
          .audioBitrate(128)
          .toFormat("mp3")
          .on("end", () => {
            log("Audio extraction synchronized");
            resolve();
          })
          .on("error", (err) => {
            log(`Audio error: ${err.message}`);
            // Non-fatal error for the whole pipeline if audio fails but frames succeed?
            // Actually, let's make it non-fatal if frames worked but audio didn't, 
            // but for now let's try to fix it.
            reject(new Error(`Audio processing failure: ${err.message}`));
          })
          .save(audioOutputPath);
      });

      const framesTask = new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .on("filenames", (filenames) => {
            job.frames = filenames.map(f => `/data/frames/${videoId}/${f}`);
          })
          .on("progress", (p) => {
            const newProgress = Math.floor(10 + (p.percent || 0) * 0.85);
            if (newProgress > job.progress && newProgress <= 95) {
              job.progress = newProgress;
            }
          })
          .on("error", (err) => {
            log(`Frames error: ${err.message}`);
            reject(new Error(`Frame extraction failure: ${err.message}`));
          })
          .on("end", () => {
            log("Frame collection finalized");
            resolve();
          })
          .screenshots({
             count: 5,
             folder: framesOutputDir,
             size: '480x?',
             filename: 'thumb-%i.jpg',
             fastSeek: true
          });
      });

      await Promise.all([audioTask, framesTask]);
      
      job.audioPath = `/data/audio/${audioFilename}`;
      job.status = "completed";
      job.progress = 100;
      log("Intelligence extraction pipeline complete");

    } catch (err: any) {
      log(`CRITICAL PIPELINE FAILURE: ${err.message}`);
      job.status = "error";
      job.error = err.message || "System encoding deadlock";
    }
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`>>> Engine running on http://localhost:${PORT}`);
  });

  // Critical for large file uploads: Prevent timeout during long transfers
  server.timeout = 10 * 60 * 1000; // 10 minutes
  server.keepAliveTimeout = 120 * 1000; // 2 minutes
  server.headersTimeout = 130 * 1000;
}

startServer();
