import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Loader2, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";

interface VoiceRecorderProps {
  onRecorded: (blobUrl: string) => void;
  recordingUrl?: string | null;
  onClear: () => void;
}

export function VoiceRecorder({ onRecorded, recordingUrl, onClear }: VoiceRecorderProps) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        onRecorded(url);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
    } catch (err: any) {
      toast({
        title: t("voice.micError"),
        description: err.message || t("voice.micErrorDesc"),
        variant: "destructive",
      });
    }
  }, [onRecorded, toast, t]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  return (
    <div className="flex items-center gap-2">
      {!recording ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={startRecording}
          className="gap-1.5 text-xs"
        >
          <Mic className="w-3.5 h-3.5 text-destructive" />
          {t("voice.record")}
        </Button>
      ) : (
        <Button
          variant="destructive"
          size="sm"
          onClick={stopRecording}
          className="gap-1.5 text-xs"
        >
          <motion.div
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ repeat: Infinity, duration: 1 }}
          >
            <MicOff className="w-3.5 h-3.5" />
          </motion.div>
          {t("voice.stop")}
        </Button>
      )}

      {recordingUrl && !recording && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="gap-1 text-xs text-muted-foreground"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      )}

      {recordingUrl && !recording && (
        <span className="text-xs text-primary">● {t("voice.recorded")}</span>
      )}
    </div>
  );
}
