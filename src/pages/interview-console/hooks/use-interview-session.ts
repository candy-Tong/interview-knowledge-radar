import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeResult, TranscriptSegment } from "../types";
import { SessionPhase } from "../types";
import {
  startSystemAudioCapture,
  type SystemAudioCapture,
} from "./system-audio";

type RealtimeEvent = {
  type?: string;
  itemId?: string;
  text?: string;
  message?: string;
  results?: KnowledgeResult[];
};

const emptySegment: Omit<TranscriptSegment, "itemId" | "createdAt"> = {
  sourceText: "",
  translatedText: "",
  isSourceFinal: false,
  isTranslationFinal: false,
  knowledgeResults: [],
};

/** Updates a transcript turn while preserving arrival order from the realtime stream. */
function updateSegment(
  segments: TranscriptSegment[],
  itemId: string,
  patch: Partial<TranscriptSegment>,
) {
  const existingIndex = segments.findIndex((segment) => segment.itemId === itemId);
  if (existingIndex === -1) {
    return [
      ...segments,
      { ...emptySegment, itemId, createdAt: Date.now(), ...patch },
    ];
  }
  return segments.map((segment, index) =>
    index === existingIndex ? { ...segment, ...patch } : segment,
  );
}

/** Owns system-audio capture, the local proxy socket, and transcript/retrieval state. */
export function useInterviewSession() {
  const [phase, setPhase] = useState(SessionPhase.Idle);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [audioSourceLabel, setAudioSourceLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<SystemAudioCapture | null>(null);
  const queuedChunksRef = useRef<ArrayBuffer[]>([]);
  const stopRef = useRef<() => Promise<void>>(async () => undefined);

  /** Stops capture immediately while letting the cloud flush its last VAD segment. */
  const stop = useCallback(async () => {
    if (phase === SessionPhase.Idle) {
      return;
    }
    setPhase(SessionPhase.Finishing);
    if (captureRef.current) {
      await captureRef.current.stop();
      captureRef.current = null;
    }
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "session.finish" }));
      window.setTimeout(() => {
        if (socket.readyState !== WebSocket.CLOSED) {
          socket.close();
        }
        setPhase(SessionPhase.Idle);
      }, 5_000);
    } else {
      socket?.close();
      setPhase(SessionPhase.Idle);
    }
    setAudioSourceLabel("");
  }, [phase]);

  stopRef.current = stop;

  /** Applies normalized server events to the interview timeline. */
  const handleRealtimeEvent = useCallback((event: RealtimeEvent) => {
    const itemId = event.itemId || `unpaired-${Date.now()}`;
    switch (event.type) {
      case "session.ready":
        setPhase(SessionPhase.Listening);
        break;
      case "speech.started":
        setPhase(SessionPhase.HearingSpeech);
        break;
      case "speech.stopped":
        setPhase(SessionPhase.Listening);
        break;
      case "source.partial":
        setSegments((values) => updateSegment(values, itemId, { sourceText: event.text ?? "" }));
        break;
      case "source.final":
        setSegments((values) =>
          updateSegment(values, itemId, {
            sourceText: event.text ?? "",
            isSourceFinal: true,
          }),
        );
        break;
      case "translation.partial":
        setSegments((values) =>
          updateSegment(values, itemId, { translatedText: event.text ?? "" }),
        );
        break;
      case "translation.final":
        setSegments((values) =>
          updateSegment(values, itemId, {
            translatedText: event.text ?? "",
            isTranslationFinal: true,
          }),
        );
        break;
      case "knowledge.results":
        setSegments((values) =>
          updateSegment(values, itemId, { knowledgeResults: event.results ?? [] }),
        );
        break;
      case "knowledge.error":
        setSegments((values) =>
          updateSegment(values, itemId, { knowledgeError: event.message }),
        );
        break;
      case "session.finished":
        socketRef.current?.close();
        setPhase(SessionPhase.Idle);
        break;
      case "session.error":
        setErrorMessage(event.message ?? "实时同传发生错误。 ");
        setPhase(SessionPhase.Error);
        break;
      case "session.disconnected":
        setErrorMessage("实时同传连接意外中断。 ");
        setPhase(SessionPhase.Error);
        break;
    }
  }, []);

  /** Requests system-audio permission, then connects to the protected realtime proxy. */
  const start = useCallback(async () => {
    setErrorMessage("");
    setPhase(SessionPhase.Connecting);
    queuedChunksRef.current = [];
    try {
      const capture = await startSystemAudioCapture(
        (chunk) => {
          const socket = socketRef.current;
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(chunk);
          } else if (queuedChunksRef.current.length < 100) {
            queuedChunksRef.current.push(chunk);
          }
        },
        () => void stopRef.current(),
      );
      captureRef.current = capture;
      setAudioSourceLabel(capture.label);

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/realtime`);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        for (const chunk of queuedChunksRef.current) {
          socket.send(chunk);
        }
        queuedChunksRef.current = [];
      };
      socket.onmessage = (message) => {
        handleRealtimeEvent(JSON.parse(message.data as string) as RealtimeEvent);
      };
      socket.onerror = () => {
        setErrorMessage("无法连接本地同传服务。 ");
        setPhase(SessionPhase.Error);
      };
      socketRef.current = socket;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "系统音频授权失败。 ");
      setPhase(SessionPhase.Error);
    }
  }, [handleRealtimeEvent]);

  const clear = useCallback(() => setSegments([]), []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      if (captureRef.current) {
        void captureRef.current.stop();
      }
    };
  }, []);

  return {
    phase,
    segments,
    audioSourceLabel,
    errorMessage,
    start,
    stop,
    clear,
  };
}
