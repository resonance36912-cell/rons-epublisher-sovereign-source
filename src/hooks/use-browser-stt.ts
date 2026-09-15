import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionCtor = new () => any;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) ?? null;
}

export function isBrowserSttSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export interface BrowserSttHookOptions {
  language?: string;
  onError?: (message: string) => void;
}

export function useBrowserStt(options: BrowserSttHookOptions = {}) {
  const { language = "en-US", onError } = options;
  const [isListening, setIsListening] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [fullTranscript, setFullTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const shouldRestartRef = useRef(false);
  // Track which result indices we've already committed so browsers (notably
  // Android Chrome) that re-emit growing/overlapping final results don't
  // cause repeated phrases to pile up in the transcript.
  const committedIndexRef = useRef(-1);

  const supported = isBrowserSttSupported();

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    setIsListening(false);
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onError?.("Browser speech recognition is not supported in this browser. Try Chrome, Edge, or Safari.");
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    committedIndexRef.current = -1;


    recognition.onresult = (event: any) => {
      let interim = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          // Only commit each result index once. Some mobile browsers
          // (Samsung/Android Chrome) re-fire isFinal for the same or
          // growing window, which previously concatenated duplicates.
          if (i > committedIndexRef.current) {
            finalChunk += transcript;
            committedIndexRef.current = i;
          }
        } else {
          interim += transcript;
        }
      }
      if (finalChunk) {
        const clean = finalChunk.trim();
        setFullTranscript((prev) => {
          if (!prev) return clean;
          // Guard against overlap: if the new chunk starts with the tail
          // of prev (or vice versa), strip the duplicate prefix.
          const prevLower = prev.toLowerCase();
          const cleanLower = clean.toLowerCase();
          // Find largest k such that prev ends with clean.slice(0, k).
          const maxK = Math.min(prevLower.length, cleanLower.length);
          let overlap = 0;
          for (let k = maxK; k > 0; k--) {
            if (prevLower.endsWith(cleanLower.slice(0, k))) {
              overlap = k;
              break;
            }
          }
          const tail = clean.slice(overlap).trim();
          if (!tail) return prev;
          return `${prev} ${tail}`;
        });
      }
      setPartialTranscript(interim);
    };


    recognition.onerror = (event: any) => {
      const code = event?.error || "unknown";
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        onError?.("Microphone access was denied. Please allow microphone access in your browser settings.");
      } else {
        onError?.(`Browser speech recognition error: ${code}`);
      }
      shouldRestartRef.current = false;
      setIsListening(false);
    };

    recognition.onend = () => {
      setPartialTranscript("");
      if (shouldRestartRef.current) {
        try {
          // Result indices restart at 0 on a new session.
          committedIndexRef.current = -1;
          recognition.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
    };


    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    try {
      recognition.start();
      setIsListening(true);
    } catch (err: any) {
      onError?.(err?.message || "Could not start browser speech recognition.");
      setIsListening(false);
    }
  }, [language, onError]);

  const reset = useCallback(() => {
    setFullTranscript("");
    setPartialTranscript("");
    committedIndexRef.current = -1;
  }, []);


  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      try {
        recognitionRef.current?.abort?.();
      } catch {
        // ignore
      }
    };
  }, []);

  return {
    supported,
    isListening,
    partialTranscript,
    fullTranscript,
    setFullTranscript,
    start,
    stop,
    reset,
  };
}
