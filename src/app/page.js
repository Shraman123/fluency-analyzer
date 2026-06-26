"use client";

import { useState, useRef, useEffect, useCallback } from "react";

const BARS = 40;
const FILLER_WORDS = ["um", "uh", "like", "you know", "so", "basically", "literally", "actually", "right", "okay"];

function ScoreRing({ score, label, size = 80 }) {
  const radius = size * 0.38;
  const circumference = 2 * Math.PI * radius;
  const filled = (score / 10) * circumference;
  const color =
    score >= 8 ? "#22c55e" : score >= 6 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#2a2a2e"
          strokeWidth={size * 0.09}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={size * 0.09}
          strokeDasharray={`${filled} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.8s ease" }}
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={color}
          fontSize={size * 0.26}
          fontWeight="700"
          fontFamily="Inter, sans-serif"
        >
          {score}
        </text>
      </svg>
      <span className="text-xs text-gray-400 font-medium tracking-wide uppercase">{label}</span>
    </div>
  );
}

function Waveform({ bars, recording }) {
  return (
    <div className="flex items-center justify-center gap-[3px] h-16">
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-1 rounded-full transition-all duration-75"
          style={{
            height: `${Math.max(4, h)}px`,
            background: recording
              ? `hsl(${260 + (h / 80) * 40}, 80%, 65%)`
              : "#3a3a44",
            animationDelay: recording ? `${(i * 40) % 400}ms` : "0ms",
          }}
        />
      ))}
    </div>
  );
}

function Badge({ text, color = "purple" }) {
  const colors = {
    purple: "bg-purple-900/40 text-purple-300 border border-purple-700/40",
    green: "bg-green-900/40 text-green-300 border border-green-700/40",
    red: "bg-red-900/40 text-red-300 border border-red-700/40",
    amber: "bg-amber-900/40 text-amber-300 border border-amber-700/40",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[color]}`}>
      {text}
    </span>
  );
}

export default function Home() {
  const [phase, setPhase] = useState("idle"); // idle | recording | transcribing | analyzing | results
  const [transcript, setTranscript] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState("");
  const [bars, setBars] = useState(Array(BARS).fill(4));
  const [elapsed, setElapsed] = useState(0);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const analyzerRef = useRef(null);
  const animFrameRef = useRef(null);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const streamRef = useRef(null);

  const animateBars = useCallback(() => {
    if (!analyzerRef.current) return;
    const data = new Uint8Array(analyzerRef.current.frequencyBinCount);
    analyzerRef.current.getByteFrequencyData(data);
    const step = Math.floor(data.length / BARS);
    const newBars = Array.from({ length: BARS }, (_, i) => {
      const slice = data.slice(i * step, (i + 1) * step);
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
      return Math.max(4, (avg / 255) * 60);
    });
    setBars(newBars);
    animFrameRef.current = requestAnimationFrame(animateBars);
  }, []);

  const startRecording = useCallback(async () => {
    setError("");
    setAnalysis(null);
    setTranscript("");
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyzer = audioCtx.createAnalyser();
      analyzer.fftSize = 256;
      source.connect(analyzer);
      analyzerRef.current = analyzer;

      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.start(100);

      setPhase("recording");
      startTimeRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);

      animateBars();
    } catch (err) {
      setError("Microphone access denied. Please allow mic access and try again.");
    }
  }, [animateBars]);

  const stopRecording = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    clearInterval(timerRef.current);
    setBars(Array(BARS).fill(4));

    const mr = mediaRecorderRef.current;
    if (!mr) return;

    mr.onstop = async () => {
      const duration = (Date.now() - startTimeRef.current) / 1000;
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });

      // Stop tracks
      streamRef.current?.getTracks().forEach((t) => t.stop());

      setPhase("transcribing");

      try {
        // Step 1: Transcribe with Whisper
        const fd = new FormData();
        fd.append("audio", blob, "recording.webm");
        const tRes = await fetch("/api/transcribe", { method: "POST", body: fd });
        const tData = await tRes.json();
        if (!tRes.ok) throw new Error(tData.error || "Transcription failed");
        const text = tData.transcript;
        setTranscript(text);

        // Step 2: Analyze with GPT-4
        setPhase("analyzing");
        const aRes = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text, durationSeconds: duration }),
        });
        const aData = await aRes.json();
        if (!aRes.ok) throw new Error(aData.error || "Analysis failed");

        setAnalysis(aData);
        setPhase("results");
      } catch (err) {
        setError(err.message);
        setPhase("idle");
      }
    };

    mr.stop();
  }, []);

  const reset = () => {
    setPhase("idle");
    setTranscript("");
    setAnalysis(null);
    setError("");
    setElapsed(0);
    setBars(Array(BARS).fill(4));
  };

  const formatTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <main className="min-h-screen bg-[#0f0f11] text-gray-100 flex flex-col items-center px-4 py-10">
      {/* Header */}
      <div className="w-full max-w-xl mb-8 text-center">
        <div className="inline-flex items-center gap-2 bg-purple-900/30 border border-purple-700/40 rounded-full px-4 py-1 mb-4">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
          <span className="text-xs text-purple-300 font-medium tracking-wider uppercase">Voice AI Demo</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">English Fluency Analyzer</h1>
        <p className="text-gray-400 text-sm">
          Speak for 15–30 seconds. Powered by OpenAI Whisper + GPT-4.
        </p>
      </div>

      {/* Main card */}
      <div className="w-full max-w-xl bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-6 shadow-xl">
        {/* Waveform */}
        <Waveform bars={bars} recording={phase === "recording"} />

        {/* Timer */}
        {phase === "recording" && (
          <div className="text-center mt-2 mb-4">
            <span className="text-2xl font-mono font-bold text-purple-400">
              {formatTime(elapsed)}
            </span>
            <p className="text-xs text-gray-500 mt-1">Speak naturally — aim for 15–30 seconds</p>
          </div>
        )}

        {/* Status text */}
        {(phase === "transcribing" || phase === "analyzing") && (
          <div className="text-center my-4">
            <div className="inline-flex items-center gap-2 text-purple-300">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
              </svg>
              <span className="text-sm font-medium">
                {phase === "transcribing" ? "Transcribing with Whisper..." : "Analyzing with GPT-4..."}
              </span>
            </div>
          </div>
        )}

        {/* Record / Stop button */}
        {(phase === "idle" || phase === "recording") && (
          <div className="flex justify-center mt-4">
            {phase === "idle" ? (
              <button
                onClick={startRecording}
                className="flex items-center gap-3 bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white font-semibold px-8 py-4 rounded-full transition-all text-base shadow-lg shadow-purple-900/40"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M12 2a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v6a2 2 0 0 0 4 0V6a2 2 0 0 0-2-2zm-7 8h2a5 5 0 0 0 10 0h2a7 7 0 0 1-6 6.92V21h3v2H8v-2h3v-2.08A7 7 0 0 1 5 12z" />
                </svg>
                Start recording
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-3 bg-red-600 hover:bg-red-500 text-white font-semibold px-8 py-4 rounded-full transition-all text-base shadow-lg shadow-red-900/40 pulse-ring"
              >
                <span className="w-3 h-3 rounded bg-white" />
                Stop & analyze
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 bg-red-900/30 border border-red-700/40 rounded-xl text-red-300 text-sm text-center">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {phase === "results" && analysis && (
        <div className="w-full max-w-xl mt-6 space-y-4">
          {/* Overall score */}
          <div className="bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-6 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">Overall score</p>
            <div className="flex justify-center mb-3">
              <ScoreRing score={analysis.overall_score} label="" size={100} />
            </div>
            <p className="text-gray-300 text-sm italic">&ldquo;{analysis.verdict}&rdquo;</p>
            <div className="flex justify-center gap-2 mt-3">
              <Badge text={`${analysis.wpm} WPM`} color="purple" />
              <Badge
                text={`${analysis.filler_words?.count || 0} filler words`}
                color={analysis.filler_words?.count > 5 ? "red" : "green"}
              />
            </div>
          </div>

          {/* Sub scores */}
          <div className="bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">Breakdown</h2>
            <div className="grid grid-cols-4 gap-2">
              <ScoreRing score={analysis.fluency_score} label="Fluency" size={72} />
              <ScoreRing score={analysis.grammar_score} label="Grammar" size={72} />
              <ScoreRing score={analysis.vocabulary_score} label="Vocab" size={72} />
              <ScoreRing score={analysis.clarity_score} label="Clarity" size={72} />
            </div>
          </div>

          {/* Transcript */}
          {transcript && (
            <div className="bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Transcript</h2>
              <p className="text-gray-200 text-sm leading-relaxed">{transcript}</p>
            </div>
          )}

          {/* Filler words */}
          {analysis.filler_words?.list?.length > 0 && (
            <div className="bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Filler words detected
              </h2>
              <div className="flex flex-wrap gap-2">
                {analysis.filler_words.list.map((w, i) => (
                  <Badge key={i} text={w} color="amber" />
                ))}
              </div>
            </div>
          )}

          {/* Grammar corrections */}
          {analysis.grammar_corrections?.length > 0 && (
            <div className="bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
                Grammar corrections
              </h2>
              <div className="space-y-3">
                {analysis.grammar_corrections.map((c, i) => (
                  <div key={i} className="text-sm">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="line-through text-red-400">{c.original}</span>
                      <span className="text-gray-500">→</span>
                      <span className="text-green-400 font-medium">{c.corrected}</span>
                    </div>
                    <p className="text-gray-500 text-xs">{c.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Strengths & improvements */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-green-400 uppercase tracking-widest mb-3">Strengths</h2>
              <ul className="space-y-2">
                {analysis.strengths?.map((s, i) => (
                  <li key={i} className="text-xs text-gray-300 flex gap-2">
                    <span className="text-green-500 mt-0.5">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-[#18181b] border border-[#2a2a2e] rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-widest mb-3">Improve</h2>
              <ul className="space-y-2">
                {analysis.improvements?.map((s, i) => (
                  <li key={i} className="text-xs text-gray-300 flex gap-2">
                    <span className="text-amber-500 mt-0.5">↑</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Try again */}
          <div className="flex justify-center pb-4">
            <button
              onClick={reset}
              className="text-sm text-purple-400 hover:text-purple-300 font-medium underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
