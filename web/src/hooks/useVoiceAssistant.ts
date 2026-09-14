import { useCallback, useEffect, useRef, useState } from "react";

const WAKE_PHRASE = "hey galaxy";

export type VoiceStatus = "off" | "wake-listening" | "capturing" | "speaking" | "unsupported";

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*_`>~-]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\n+/g, ". ")
    .trim();
}

/** Split cleaned text into speakable chunks so no single utterance runs long
 * enough to hit Chrome's speechSynthesis bug where it silently stops speaking
 * after roughly 15s of audio in one utterance. Chunking on sentence boundaries
 * also gives the voice natural breathing pauses instead of one flat run-on. */
function toSpeechChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*(\s+|$)/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > 180 && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Ranked by how natural real browsers' voices actually sound -- premium
// "Natural"/"Neural"/"Online" engines first, then Google's higher-quality
// voices, then everything else. Avoids the old British-only filter, which
// could land on a low-quality UK voice when a much better US/AU one was
// available.
const QUALITY_HINT = /\b(natural|neural|online|premium)\b/i;
const GOOGLE_HINT = /\bgoogle\b/i;
const LOW_QUALITY_HINT = /\b(compact|espeak|festival)\b/i;

function scoreVoice(v: SpeechSynthesisVoice): number {
  let score = 0;
  if (QUALITY_HINT.test(v.name)) score += 30;
  if (GOOGLE_HINT.test(v.name)) score += 20;
  if (LOW_QUALITY_HINT.test(v.name)) score -= 40;
  if (/^en-(us|gb|au)$/i.test(v.lang ?? "")) score += 10;
  if (v.localService) score += 2;
  return score;
}

function pickBestVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !window.speechSynthesis) return undefined;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
  if (voices.length === 0) return undefined;
  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
}

export function useVoiceAssistant(onCommand: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("off");
  const recognitionRef = useRef<InstanceType<NonNullable<Window["webkitSpeechRecognition"]>> | null>(null);
  const modeRef = useRef<"wake-listening" | "capturing">("wake-listening");
  const shouldRunRef = useRef(false);
  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechGenRef = useRef(0);

  // Chrome loads its voice list asynchronously -- prime it so the best voice is
  // available the first time speak() is called, not just after a second call.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const handler = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
  }, []);

  const getEngine = () =>
    typeof window !== "undefined" ? window.SpeechRecognition ?? window.webkitSpeechRecognition : undefined;

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const clean = stripMarkdown(text).slice(0, 2000);
    if (!clean) return;
    window.speechSynthesis.cancel();
    const myGen = ++speechGenRef.current;
    const wasRunning = shouldRunRef.current;
    if (wasRunning) recognitionRef.current?.stop();

    const voice = pickBestVoice();
    const chunks = toSpeechChunks(clean);
    if (chunks.length === 0) return;

    const finish = () => {
      if (wasRunning) {
        modeRef.current = "wake-listening";
        try {
          recognitionRef.current?.start();
        } catch {
          // already starting; ignore
        }
        setStatus("wake-listening");
      } else {
        setStatus("off");
      }
    };

    const speakChunk = (index: number) => {
      if (speechGenRef.current !== myGen) return; // superseded by a newer speak() or disable()
      if (index >= chunks.length) {
        finish();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utterance.rate = 0.98;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "en-US";
      }
      utterance.onstart = () => setStatus("speaking");
      utterance.onend = () => speakChunk(index + 1);
      utterance.onerror = () => speakChunk(index + 1);
      window.speechSynthesis.speak(utterance);
    };

    speakChunk(0);
  }, []);

  const armCaptureTimeout = useCallback(() => {
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
    captureTimeoutRef.current = setTimeout(() => {
      modeRef.current = "wake-listening";
      setStatus((s) => (s === "capturing" ? "wake-listening" : s));
    }, 7000);
  }, []);

  const enable = useCallback(() => {
    const Engine = getEngine();
    if (!Engine) {
      setStatus("unsupported");
      return;
    }
    if (recognitionRef.current) return;
    const recognition = new Engine();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
      }
      if (!finalChunk) return;
      const lower = finalChunk.toLowerCase();

      if (modeRef.current === "wake-listening") {
        const idx = lower.indexOf(WAKE_PHRASE);
        if (idx === -1) return;
        const remainder = finalChunk.slice(idx + WAKE_PHRASE.length).trim();
        if (remainder.length > 2) {
          onCommand(remainder);
          armCaptureTimeout();
        } else {
          modeRef.current = "capturing";
          setStatus("capturing");
          armCaptureTimeout();
        }
      } else {
        if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
        modeRef.current = "wake-listening";
        setStatus("wake-listening");
        onCommand(finalChunk.trim());
      }
    };

    recognition.onerror = (event) => {
      const err = (event as unknown as { error?: string }).error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        shouldRunRef.current = false;
        setStatus("off");
      }
    };

    recognition.onend = () => {
      if (shouldRunRef.current) {
        try {
          recognition.start();
        } catch {
          // ignore duplicate-start errors
        }
      }
    };

    recognitionRef.current = recognition;
    shouldRunRef.current = true;
    modeRef.current = "wake-listening";
    try {
      recognition.start();
      setStatus("wake-listening");
    } catch {
      setStatus("off");
    }
  }, [onCommand, armCaptureTimeout]);

  const disable = useCallback(() => {
    shouldRunRef.current = false;
    speechGenRef.current++; // invalidate any in-flight chunked speech chain
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    window.speechSynthesis?.cancel();
    setStatus("off");
  }, []);

  return { status, enable, disable, speak };
}
