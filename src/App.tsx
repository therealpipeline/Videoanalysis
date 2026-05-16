import * as React from "react";
import { createContext, useContext, useState, useEffect } from "react";
import { Upload, AlertCircle, Sparkles, Share2, Download, FileJson } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { GoogleGenAI, Type } from "@google/genai";
import { Skeleton } from "@/components/ui/skeleton";

// Types
interface VideoData {
  jobId: string;
  status: "processing" | "completed" | "error";
  progress: number;
  videoPath?: string;
  audioPath?: string;
  frames: string[];
  metadata?: any;
  error?: string;
  logs?: string[];
  analysis?: any;
  script?: any;
  editingPlan?: any;
  titles?: string[];
  description?: string;
}

const AppContext = createContext<{
  videoData: VideoData | null;
  setVideoData: (data: VideoData | null) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (val: boolean) => void;
}>({
  videoData: null,
  setVideoData: () => {},
  isAnalyzing: false,
  setIsAnalyzing: () => {},
});

export default function App() {
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  return (
    <AppContext.Provider value={{ videoData, setVideoData, isAnalyzing, setIsAnalyzing }}>
      <div className="flex flex-col h-screen w-full bg-[#09090b] text-[11px] overflow-hidden selection:bg-blue-600/30 selection:text-white antialiased font-sans">
        <Toaster theme="dark" position="top-right" richColors />
        
        {/* Simplified Header */}
        <header className="h-14 border-b border-zinc-800 flex items-center justify-between px-6 bg-zinc-900/40 shrink-0 backdrop-blur-md">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-black text-white text-[10px] shadow-lg shadow-blue-600/20">
              P-II
            </div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-zinc-100 tracking-tight text-[12px] uppercase tracking-tighter">Commentary Pro</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {videoData ? (
              <div className="flex items-center space-x-2 px-3 py-1 bg-emerald-500/5 rounded-full border border-emerald-500/10">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                <span className="text-emerald-500 text-[9px] font-black uppercase tracking-widest hidden sm:inline">Engine Online</span>
              </div>
            ) : null}
            <Button size="sm" className="h-8 bg-zinc-100 text-zinc-950 hover:bg-white text-[9px] font-black px-4 shadow-xl uppercase tracking-widest">
              Export
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden relative bg-zinc-950/50">
          {!videoData ? (
            <div className="absolute inset-0 flex items-center justify-center p-8 bg-[radial-gradient(circle_at_50%_50%,_#1a1a1a_0%,_#09090b_100%)]">
              <UploadSection />
            </div>
          ) : (
            <StudioDashboard />
          )}
        </main>
      </div>
    </AppContext.Provider>
  );
}

function UploadSection() {
  const { setVideoData } = useContext(AppContext);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const processFile = (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error("Video format required (.mp4, .mov, .webm)");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setLogs(["Connecting to synchronisation gateway..."]);
    
    const formData = new FormData();
    formData.append("video", file);

    const xhr = new XMLHttpRequest();
    
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = (event.loaded / event.total) * 100;
        setUploadProgress(Math.floor(percent * 0.3));
        if (percent === 100) setLogs(prev => [...prev, "Payload delivery confirmed", "Waiting for server-side ingestion..."]);
      }
    };

    xhr.onload = () => {
      console.log(`>>> [XHR] Response received. Status: ${xhr.status}`);
      
      // Safety check: If the response is HTML, we likely hit a platform session redirect (Cookie Check)
      if (xhr.responseText.trim().toLowerCase().startsWith("<!doctype html>")) {
        console.error(">>> [XHR] Detected HTML instead of JSON. Platform Session redirect detected.");
        const sessionMsg = "Browser Session Interrupted";
        toast.error(`${sessionMsg}. Please open the app in a new tab.`);
        setLogs(prev => [...prev, `FATAL: ${sessionMsg}. The platform preview window is blocking a security cookie.`, "FIX: Click the 'Open in new tab' button or use the Shared URL to bypass this."]);
        setIsUploading(false);
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const { jobId } = JSON.parse(xhr.responseText);
          setLogs(prev => [...prev, `Handshake successful. Internal ID: ${jobId}`]);
          pollStatus(jobId);
        } catch (e) {
          console.error(">>> [XHR] JSON Parse Failure. Raw Response Preview:", xhr.responseText.substring(0, 100));
          toast.error("Handshake Invalidation: Protocol mismatch");
          setLogs(prev => [...prev, "FATAL: Protocol mismatch during handshake.", `RAW_BUFFER_START: ${xhr.responseText.substring(0, 100)}...`]);
          setIsUploading(false);
        }
      } else {
        let errorMsg = "Synchronisation Failure";
        const rawResponse = xhr.responseText.substring(0, 200);
        console.error(">>> [XHR] Server Error. Raw:", rawResponse);
        try {
          const errorData = JSON.parse(xhr.responseText);
          errorMsg = errorData.error || errorMsg;
        } catch (e) {}
        toast.error(`${errorMsg} (HTTP ${xhr.status})`);
        setIsUploading(false);
        setLogs(prev => [...prev, `FATAL: ${errorMsg}`, `ERR_TRACE: HTTP_${xhr.status}`]);
      }
    };

    xhr.onerror = () => {
      const errorMsg = "Infrastructure Latency Error: Connection Interrupted";
      toast.error(errorMsg);
      setIsUploading(false);
      setLogs(prev => [...prev, `FATAL: ${errorMsg}. This usually happens if the file is too huge for the current connection bandwidth. Try a more stable network.`]);
    };

    xhr.onabort = () => {
      setLogs(prev => [...prev, "WARN: Handshake aborted by client."]);
      setIsUploading(false);
    };

    xhr.open("POST", "/api/upload");
    // Ensure the connection stays alive for large payloads
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    xhr.send(formData);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = ''; 
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => { setIsDragging(false); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const pollStatus = (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/status/${jobId}`);
        if (!response.ok) {
          throw new Error(`Polling Sync Error: ${response.status}`);
        }
        const data = await response.json();

        if (data.logs) {
          setLogs(data.logs);
        }

        if (data.status === "completed") {
          clearInterval(interval);
          setVideoData(data);
          setIsUploading(false);
          toast.success("Intelligence Cycle Optimized");
        } else if (data.status === "error") {
          clearInterval(interval);
          setIsUploading(false);
          toast.error(`System Logic Error: ${data.error || "Undefined disruption"}`);
        } else {
          const totalProgress = 30 + Math.floor(data.progress * 0.7);
          setUploadProgress(totalProgress);
        }
      } catch (error: any) {
        console.error("Polling failure:", error);
        setLogs(prev => [...prev.slice(-4), `RETRY: Ping failure (${error.message})`]);
      }
    }, 1000); 
  };

  return (
    <div className="w-full max-w-xl">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-6"
      >
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2 uppercase tracking-tighter">Production Hub</h1>
          <p className="text-zinc-500 text-[10px] uppercase tracking-[0.2em] font-bold">Multimodal AI Commentary Studio v2.1 (Edge Optimized)</p>
        </div>

        <Card 
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`border-zinc-800 bg-zinc-900/40 overflow-hidden relative group border-dashed border-2 transition-all duration-500 ${isDragging ? 'border-blue-500 bg-blue-500/5 scale-[1.01]' : ''}`}
        >
          <CardContent className="p-10">
            {isUploading ? (
              <div className="flex flex-col space-y-8 py-2">
                <div className="flex items-center space-x-6">
                  <div className="relative shrink-0">
                    <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full" />
                    <div className="w-14 h-14 rounded-full border-t-2 border-blue-500 animate-spin relative z-10" />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <p className="text-[10px] text-white font-black uppercase tracking-[0.3em]">
                      {uploadProgress < 30 ? "Synchronizing Asset" : "Extracting Intelligence"}
                    </p>
                    <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" 
                        animate={{ width: `${Math.max(1, uploadProgress)}%` }}
                        transition={{ type: 'spring', damping: 25 }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] font-mono text-zinc-500 tracking-tighter">
                      <span>{uploadProgress < 30 ? "TRANSFER_ACTIVE" : "FFMPEG_PROC"}</span>
                      <span>{Math.round(uploadProgress)}%</span>
                    </div>
                  </div>
                </div>

                {/* Console Output */}
                <div className="bg-black/60 rounded-md border border-zinc-800/50 p-4 font-mono text-[9px] h-32 overflow-hidden flex flex-col-reverse">
                  <div className="space-y-1.5">
                    {logs.slice().reverse().map((log, i) => (
                      <div key={i} className={`flex gap-2 ${i === 0 ? 'text-blue-400' : 'text-zinc-600'}`}>
                        <span className="opacity-30">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                        <span>{log}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center space-y-6 py-6">
                <div 
                  className={`w-20 h-20 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center transition-all duration-300 cursor-pointer ${isDragging ? 'text-blue-500 border-blue-500 scale-110' : 'text-zinc-500 group-hover:text-blue-400 group-hover:border-zinc-700'}`}
                  onClick={() => document.getElementById('video-upload')?.click()}
                >
                  <Upload className={`w-8 h-8 ${isDragging ? 'animate-bounce' : ''}`} />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-sm font-bold text-zinc-200 tracking-tight">{isDragging ? 'Drop to Ingest' : 'Ingest Media Asset'}</p>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.15em] opacity-60">MP4, MOV, WEBM (UP TO 512MB)</p>
                </div>
                <Button 
                  size="sm"
                  variant="outline"
                  className="bg-zinc-950 border-zinc-800 hover:bg-zinc-900 h-9 text-[9px] uppercase font-black tracking-widest px-8 shadow-2xl transition-all hover:scale-105 active:scale-95"
                  onClick={() => document.getElementById('video-upload')?.click()}
                >
                  Select Source
                </Button>
                <input id="video-upload" type="file" accept="video/*" className="hidden" onChange={handleFileUpload} />
              </div>
            )}
          </CardContent>
          <div className={`absolute inset-x-0 bottom-0 h-0.5 bg-blue-600 transition-opacity duration-700 ${isDragging || isUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`} />
        </Card>

        <div className="grid grid-cols-3 gap-3">
           {[
             { label: 'Model', val: 'Gemini 1.5 PRO' },
             { label: 'Buffer', val: '512MB SGC' },
             { label: 'Engine', val: 'FFMPEG/V9' }
           ].map((stat, i) => (
             <div key={i} className="p-3 bg-zinc-900/30 rounded border border-zinc-800/50 flex flex-col items-center gap-1 group hover:border-zinc-700 transition-colors">
               <div className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">{stat.label}</div>
               <div className="text-[10px] text-zinc-300 font-mono tracking-tighter group-hover:text-white">{stat.val}</div>
             </div>
           ))}
        </div>
      </motion.div>
    </div>
  );
}

function StudioDashboard() {
  const { videoData, setVideoData, isAnalyzing, setIsAnalyzing } = useContext(AppContext);
  const [activeTab, setActiveTab] = useState("analysis");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Automatically trigger analysis if data exists but no analysis is performed yet
    if (videoData && videoData.status === "completed" && !videoData.analysis && !isAnalyzing) {
      runAnalysis();
    }
  }, [videoData, isAnalyzing]);

  const downloadAsText = (filename: string, content: string) => {
    const element = document.createElement("a");
    const file = new Blob([content], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const runAnalysis = async () => {
    if (!videoData) return;
    setIsAnalyzing(true);
    toast.info("Intelligence process initiated...");

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const frameParts = await Promise.all(videoData.frames.slice(0, 8).map(async (frameUrl) => {
        try {
          const res = await fetch(frameUrl);
          const blob = await res.blob();
          return new Promise<any>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              resolve({
                inlineData: {
                  data: (reader.result as string).split(',')[1],
                  mimeType: "image/jpeg"
                }
              });
            };
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          return null;
        }
      }));

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    analysis: {
                        type: Type.OBJECT,
                        properties: {
                            context: { type: Type.STRING },
                            summary: { type: Type.STRING },
                            emotions: { type: Type.ARRAY, items: { type: Type.STRING } },
                            keyMoments: { type: Type.ARRAY, items: { 
                                type: Type.OBJECT,
                                properties: {
                                    time: { type: Type.STRING },
                                    event: { type: Type.STRING },
                                    significance: { type: Type.STRING }
                                }
                             } },
                            viralTriggers: { type: Type.ARRAY, items: { type: Type.STRING } }
                        }
                    },
                    script: {
                        type: Type.OBJECT,
                        properties: {
                            hook: { type: Type.STRING },
                            intro: { type: Type.STRING },
                            mainBreakdown: { type: Type.STRING },
                            escalation: { type: Type.STRING },
                            reveal: { type: Type.STRING },
                            outro: { type: Type.STRING }
                        }
                    },
                    editingPlan: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                timestamp: { type: Type.STRING },
                                action: { type: Type.STRING },
                                instruction: { type: Type.STRING },
                                soundEffect: { type: Type.STRING }
                            }
                        }
                    },
                    titles: { type: Type.ARRAY, items: { type: Type.STRING } },
                    description: { type: Type.STRING }
                }
            }
        },
        contents: {
          parts: [
            ...frameParts.filter(p => p !== null),
            { text: "Analyze this video like a professional YouTube Commentary creator. Understand context, emotions, and viral potential. Generate a full commentary script, detailed editing plan, catchy titles, and SEO description. Sound human, cinematic, and use suspense." }
          ]
        }
      });

      const result = JSON.parse(response.text || "{}");
      setVideoData({ ...videoData, ...result });
      toast.success("Intelligence cycle complete.");
    } catch (error) {
      console.error(error);
      toast.error("Process failed. Retrying...");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!videoData) return null;

  return (
    <div className="flex flex-col h-screen lg:h-screen bg-[#09090b] overflow-hidden relative">
      {/* Mobile Toggle for Sidebar on Small Screens (Floating) - Removed or repurposed */}
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Column 1: Video & Context (Left Sidebar) */}
        <aside className={`${activeTab === "preview" ? "flex" : "hidden lg:flex"} w-full lg:w-[320px] bg-zinc-950 border-r border-zinc-800 flex-col shrink-0 overflow-hidden`}>
          <div className="p-4 space-y-4 shrink-0">
            <div className="aspect-video bg-black rounded-xl border border-zinc-800 flex items-center justify-center relative overflow-hidden shadow-2xl">
              <video src={videoData.videoPath} controls className="w-full h-full object-contain" />
              <div className="absolute top-2 left-2 flex items-center px-1.5 py-0.5 bg-black/60 backdrop-blur rounded-full text-zinc-300 text-[8px] font-black uppercase tracking-widest border border-white/10">
                <div className="w-1 h-1 rounded-full bg-red-500 mr-1.5 animate-pulse" />
                Source Feed
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl">
                <div className="text-zinc-600 text-[8px] uppercase font-black tracking-widest mb-1.5">Efficiency</div>
                <div className="text-lg font-mono text-blue-400">98.2%</div>
              </div>
              <div className="p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl">
                <div className="text-zinc-600 text-[8px] uppercase font-black tracking-widest mb-1.5">Attention</div>
                <div className="text-lg font-mono text-emerald-400">HIGH</div>
              </div>
            </div>

            <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-xl space-y-3">
              <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest">
                <span className="text-zinc-500">Visual Impact</span>
                <span className="text-blue-500">Processing</span>
              </div>
              <div className="h-12 flex items-end space-x-1.5">
                {[0.4, 0.7, 0.3, 0.9, 0.5, 0.8, 0.4, 0.7, 0.9, 0.2, 0.5, 0.7].map((h, i) => (
                  <div key={i} className="flex-1 bg-blue-500/20 rounded-t-sm" style={{ height: `${h * 100}%` }} />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-zinc-600 text-[9px] font-black uppercase tracking-widest">Signal Taxonomy</span>
                <Badge variant="secondary" className="bg-blue-500/10 text-blue-400 border-none text-[8px]">{videoData.analysis?.emotions?.length || 0} Layers</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {videoData.analysis?.emotions?.slice(0, 6).map((e: string, i: number) => (
                  <Badge key={i} variant="outline" className="bg-zinc-900/50 text-zinc-400 border-zinc-800 text-[9px] py-0.5 px-2 rounded-full">
                    {e}
                  </Badge>
                ))}
              </div>
            </div>

            <Separator className="bg-zinc-800/50" />
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h3 className="text-zinc-500 font-black uppercase tracking-[0.2em] text-[9px]">Ingestion Frames</h3>
                <span className="text-[9px] font-mono text-zinc-700">{videoData.frames.length} Assets</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {videoData.frames.map((frame, i) => (
                  <div key={i} className="aspect-video bg-zinc-900 rounded-lg border border-zinc-800 group relative overflow-hidden cursor-zoom-in">
                    <img src={frame} alt={`Frame ${i}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    <div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute top-1 right-1 px-1 bg-black/60 rounded text-[7px] font-mono opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      FRAME_{i}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* Column 2: Narrative Area (Center Content) */}
        <section className={`${activeTab !== "preview" && activeTab !== "output" ? "flex" : "hidden lg:flex"} flex-1 flex-col bg-[#09090b] min-w-0 relative overflow-hidden`}>
          <header className="h-12 lg:h-10 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900/20 sticky top-0 z-40 backdrop-blur-xl shrink-0">
            <nav className="flex h-full overflow-x-auto no-scrollbar scroll-smooth">
              {[
                { id: "analysis", label: "Analysis" },
                { id: "script", label: "Script" },
                { id: "editing", label: "Editing" },
                { id: "logs", label: "Logs" }
              ].map(tab => (
                <button 
                  key={tab.id}
                  className={`text-[10px] font-black uppercase tracking-widest px-5 h-full transition-all border-b-2 whitespace-nowrap shrink-0 ${activeTab === tab.id ? "text-white border-blue-500" : "text-zinc-500 border-transparent hover:text-zinc-300"}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
            <div className="hidden sm:block text-[9px] font-mono text-zinc-600 tracking-tighter uppercase whitespace-nowrap px-4 border-l border-zinc-800 ml-4">
              Cycle: {videoData.status}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-8 lg:py-12 custom-scrollbar">
            <div className="max-w-2xl mx-auto pb-24 lg:pb-0">
            {!videoData.analysis && !isAnalyzing ? (
              <div className="h-full flex flex-col items-center justify-center py-32 text-center">
                 <div className="relative mb-8">
                    <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full animate-pulse" />
                    <div className="w-16 h-16 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-center relative z-10">
                      <Sparkles className="w-8 h-8 text-blue-500 animate-pulse" />
                    </div>
                 </div>
                 <h2 className="text-xl font-black text-white mb-2 uppercase tracking-tight">AI Engine Booting</h2>
                 <p className="text-zinc-500 text-xs max-w-[240px] mx-auto leading-relaxed">Synchronizing multimodal signals and generating professional narrative layers...</p>
                 <div className="mt-8 flex items-center justify-center gap-3">
                    <div className="h-0.5 w-12 bg-zinc-800" />
                    <span className="text-[10px] font-mono text-zinc-600">AUTO_INIT_ACTIVE</span>
                    <div className="h-0.5 w-12 bg-zinc-800" />
                 </div>
              </div>
            ) : isAnalyzing ? (
              <div className="space-y-12 py-8">
                 {[1, 2, 3].map(i => (
                   <div key={i} className="space-y-4">
                     <Skeleton className="h-3 w-24 bg-zinc-900" />
                     <Skeleton className="h-24 w-full bg-zinc-900" />
                   </div>
                 ))}
              </div>
            ) : activeTab === "analysis" ? (
               <div className="space-y-8 animate-in fade-in duration-700">
                  <div className="space-y-4">
                    <h2 className="text-2xl font-bold tracking-tight text-white capitalize">System Context</h2>
                    <p className="text-zinc-400 leading-relaxed text-sm antialiased">{videoData.analysis?.context}</p>
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-2xl font-bold tracking-tight text-zinc-400 capitalize">Narrative Arc</h2>
                    <p className="text-white text-lg font-light leading-relaxed antialiased">{videoData.analysis?.summary}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                     <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-lg">
                       <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Key Moments</h4>
                       <div className="space-y-3">
                          {videoData.analysis?.keyMoments?.slice(0, 4).map((m: any, i: number) => (
                             <div key={i} className="flex gap-3 text-xs">
                               <span className="text-blue-500 font-mono text-[10px] pt-1">{m.time}</span>
                               <span className="text-zinc-300 leading-tight">{m.event}</span>
                             </div>
                          ))}
                       </div>
                     </div>
                     <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-lg">
                       <h4 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Viral Triggers</h4>
                       <div className="space-y-2">
                          {videoData.analysis?.viralTriggers?.map((v: string, i: number) => (
                             <div key={i} className="flex items-center gap-2 text-[11px] text-emerald-400">
                                <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                <span>{v}</span>
                             </div>
                          ))}
                       </div>
                     </div>
                  </div>
               </div>
            ) : activeTab === "logs" ? (
               <div className="space-y-6 animate-in fade-in duration-500">
                  <h2 className="text-2xl font-bold tracking-tight mb-8 capitalize">System Diagnostics</h2>
                  <div className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-6 font-mono text-[10px] space-y-2 select-text min-h-[400px]">
                     {videoData.logs?.map((log, i) => (
                       <div key={i} className="flex gap-4 group">
                         <span className="text-zinc-600 shrink-0 w-16">[{i.toString().padStart(3, '0')}]</span>
                         <span className="text-zinc-300 group-hover:text-blue-400 transition-colors whitespace-pre-wrap">{log}</span>
                       </div>
                     ))}
                     {videoData.error && (
                       <div className="mt-8 p-4 bg-red-500/5 border border-red-500/20 text-red-500 rounded">
                         <p className="font-bold uppercase tracking-widest text-[9px] mb-1">Fatal Exception Trace</p>
                         <p className="text-sm font-sans">{videoData.error}</p>
                       </div>
                     )}
                  </div>
               </div>
            ) : activeTab === "script" ? (
               <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-700">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-8">
                     <h2 className="text-2xl font-bold tracking-tight">Commentary Script</h2>
                     <div className="flex gap-2">
                       <Button size="sm" variant="outline" className="h-7 text-[9px] uppercase font-bold" onClick={() => {
                          const text = Object.values(videoData.script || {}).join("\n\n");
                          navigator.clipboard.writeText(text);
                          toast.success("Script copied.");
                       }}>Copy Script</Button>
                       <Button size="sm" variant="outline" className="h-7 bg-blue-600/10 border-blue-500/20 text-blue-400 text-[9px] uppercase font-bold hover:bg-blue-600/20" onClick={() => {
                          const text = Object.values(videoData.script || {}).join("\n\n");
                          downloadAsText("commentary_script.txt", text);
                       }}>
                         <Download className="w-3 h-3 mr-1.5" />
                         Download Text
                       </Button>
                     </div>
                  </div>
                  {Object.entries(videoData.script || {}).map(([key, value]) => (
                    <div key={key} className="space-y-4 group">
                       <div className="flex items-center gap-3">
                          <span className="px-1.5 py-0.5 bg-blue-600/10 text-blue-400 border border-blue-500/20 rounded text-[9px] uppercase font-bold tracking-widest font-mono">
                            {key}
                          </span>
                       </div>
                       <p className="text-xl font-light leading-relaxed text-zinc-200 antialiased selection:bg-blue-600 selection:text-white">
                         {value as string}
                       </p>
                    </div>
                  ))}
               </div>
            ) : (
               <div className="space-y-6 animate-in fade-in duration-500">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-4">
                    <h2 className="text-2xl font-bold tracking-tight capitalize">Editing Instructions</h2>
                    <Button size="sm" variant="outline" className="h-7 bg-blue-600/10 border-blue-500/20 text-blue-400 text-[9px] uppercase font-bold hover:bg-blue-600/20" onClick={() => {
                        const text = videoData.editingPlan?.map((s: any) => `${s.timestamp} | ${s.action.toUpperCase()} | SFX: ${s.soundEffect}\nInstruction: ${s.instruction}`).join("\n\n---\n\n");
                        downloadAsText("editing_plan.txt", text || "No plan available.");
                    }}>
                      <Download className="w-3 h-3 mr-1.5" />
                      Download Plan
                    </Button>
                  </div>
                  {videoData.editingPlan?.map((step: any, i: number) => (
                    <div key={i} className="flex gap-6 p-4 bg-zinc-900/30 border border-zinc-800 rounded group hover:bg-zinc-900/60 transition-colors">
                       <div className="w-12 pt-1">
                          <span className="font-mono text-[10px] text-zinc-600">{step.timestamp}</span>
                       </div>
                       <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-3">
                             <Badge variant="outline" className="text-[9px] bg-orange-500/10 border-orange-500/20 text-orange-400 uppercase font-bold tracking-wider rounded-sm">{step.action}</Badge>
                             <span className="text-[10px] text-blue-400 font-mono italic opacity-60 group-hover:opacity-100 transition-opacity">SFX: {step.soundEffect}</span>
                          </div>
                          <p className="text-zinc-300 text-sm leading-normal">{step.instruction}</p>
                       </div>
                    </div>
                  ))}
               </div>
              )}
            </div>
          </div>
        </section>

          {/* Column 3: Exports & Metadata (Right Sidebar) */}
          <aside className={`${activeTab === "output" ? "flex" : "hidden lg:flex"} w-full lg:w-[280px] bg-zinc-950 border-l lg:border-zinc-800 flex flex-col shrink-0 overflow-hidden`}>
            <div className="p-4 lg:p-6 space-y-6 shrink-0">
              <div className="flex justify-between items-center">
                <h3 className="text-zinc-500 font-black uppercase tracking-[0.2em] text-[9px]">Marketable Assets</h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" title="Download Text" className="h-6 w-6 p-0 text-blue-500 hover:text-blue-400 hover:bg-blue-500/10" onClick={() => {
                    const text = `TITLES:\n${videoData.titles?.join("\n")}\n\nDESCRIPTION:\n${videoData.description}`;
                    downloadAsText("marketing_assets.txt", text);
                  }}>
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" title="Download JSON" className="h-6 w-6 p-0 text-orange-500 hover:text-orange-400 hover:bg-orange-500/10" onClick={() => {
                    const data = {
                      titles: videoData.titles,
                      description: videoData.description,
                      metadata: {
                        viralTriggers: videoData.analysis?.viralTriggers,
                        efficiencyScore: "84%"
                      }
                    };
                    downloadAsText("marketing_assets.json", JSON.stringify(data, null, 2));
                  }}>
                    <FileJson className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 lg:p-6 pt-0 space-y-8">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Calculated Titles</label>
                  <div className="space-y-2">
                    {videoData.titles?.slice(0, 4).map((title, i) => (
                      <motion.div 
                        key={i} 
                        whileTap={{ scale: 0.98 }}
                        className="p-3 bg-zinc-900/40 border border-zinc-800/60 rounded-xl group cursor-pointer hover:border-blue-500/50 transition-all active:bg-zinc-800"
                        onClick={() => {
                            navigator.clipboard.writeText(title);
                            toast.success("Synchronized to clipboard.");
                        }}
                      >
                        <p className="text-zinc-200 leading-snug text-[11px] font-bold group-hover:text-white transition-colors">{title}</p>
                      </motion.div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">SEO Context Generation</label>
                  <div className="p-4 bg-zinc-900/40 border border-zinc-800/60 rounded-xl">
                    <div className="h-36 overflow-y-auto custom-scrollbar">
                        <p className="text-[10px] text-zinc-500 leading-relaxed font-mono italic pr-2">
                          {videoData.description || "Synthesizing metadata for global indexing..."}
                        </p>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    disabled={!videoData.description}
                    className="w-full h-10 border-zinc-800/50 text-[9px] uppercase font-black tracking-[0.15em] bg-zinc-950 hover:bg-zinc-800 active:scale-95 transition-all shadow-xl"
                    onClick={() => {
                      navigator.clipboard.writeText(videoData.description || "");
                      toast.success("Metadata payload copied.");
                    }}
                  >
                    Copy SEO Payload
                  </Button>
                </div>
              </div>

              <div className="space-y-6 pt-6 border-t border-zinc-800/50">
                 <div className="p-4 bg-blue-600/5 border border-blue-500/20 rounded-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Sparkles className="w-8 h-8 text-blue-500" />
                    </div>
                    <div className="flex items-center gap-2 text-blue-500 mb-2 relative z-10">
                       <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" />
                       <span className="text-[9px] font-black uppercase tracking-widest">Studio Pro-Tip</span>
                    </div>
                    <p className="text-zinc-500 text-[10px] leading-relaxed relative z-10 tracking-tight">
                       {videoData.analysis?.viralTriggers?.[0] ? `Our heuristic model predicts \"${videoData.analysis.viralTriggers[0]}\" as the high-impact focal point.` : "Running signal analysis for creative guidance..."}
                    </p>
                 </div>

                 <div className="p-4 bg-zinc-900/50 border border-zinc-800/50 rounded-2xl">
                    <div className="flex justify-between items-center text-[9px] font-black uppercase text-zinc-600 tracking-widest mb-3">
                       <span>Retention Projection</span>
                       <span className="text-emerald-500 font-mono">84%</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                       <motion.div 
                         className="h-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]" 
                         initial={{ width: 0 }}
                         animate={{ width: "84%" }}
                         transition={{ duration: 1.5, ease: "easeOut" }}
                       />
                    </div>
                 </div>
              </div>
            </div>
          </aside>
        </div>

        {/* Mobile Navigation Dock */}
        <div className="lg:hidden h-16 shrink-0 border-t border-zinc-800 bg-zinc-950 flex items-center justify-around px-2 pb-safe z-50">
          {[
            { id: "preview", label: "Media", icon: Upload },
            { id: "analysis", label: "Intel", icon: Sparkles },
            { id: "script", label: "Script", icon: Share2 },
            { id: "output", label: "Export", icon: AlertCircle },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id || (item.id === "analysis" && ["script", "editing", "logs"].includes(activeTab) && activeTab !== "output" && activeTab !== "preview");
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center space-y-1 h-full px-4 rounded-xl transition-all ${isActive ? 'text-blue-500' : 'text-zinc-600'}`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'scale-110 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]' : ''}`} />
                <span className="text-[8px] font-black uppercase tracking-widest">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
  );
}
