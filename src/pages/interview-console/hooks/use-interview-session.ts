import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewQuestion, KnowledgeResult, TranscriptSegment } from "../types";
import { RealtimeMode, SessionPhase } from "../types";
import {
  startSystemAudioCapture,
  type SystemAudioCapture,
} from "./system-audio";

type RealtimeEvent = {
  type?: string;
  itemId?: string;
  text?: string;
  message?: string;
  questionId?: string;
  questions?: Array<Pick<InterviewQuestion, "id" | "text" | "isFinal">>;
  results?: KnowledgeResult[];
};

const emptySegment: Omit<TranscriptSegment, "itemId" | "mode" | "createdAt"> = {
  sourceText: "",
  translatedText: "",
  isSourceFinal: false,
  isTranslationFinal: false,
  questions: [],
};

/** Updates a transcript turn while preserving arrival order from the realtime stream. */
function updateSegment(
  segments: TranscriptSegment[],
  itemId: string,
  mode: RealtimeMode,
  patch: Partial<TranscriptSegment>,
) {
  const existingIndex = segments.findIndex((segment) => segment.itemId === itemId);
  if (existingIndex === -1) {
    return [
      ...segments,
      { ...emptySegment, itemId, mode, createdAt: Date.now(), ...patch },
    ];
  }
  return segments.map((segment, index) =>
    index === existingIndex ? { ...segment, ...patch } : segment,
  );
}

/** Reconciles split questions while retaining knowledge only for unchanged question text. */
function reconcileQuestions(
  currentQuestions: InterviewQuestion[],
  questions: NonNullable<RealtimeEvent["questions"]>,
) {
  return questions.map((question) => {
    const current = currentQuestions.find((value) => value.id === question.id);
    return {
      ...question,
      knowledgeResults: current?.text === question.text ? current.knowledgeResults : [],
      knowledgeError: current?.text === question.text ? current.knowledgeError : undefined,
    };
  });
}

/** Updates one question without changing sibling questions in the same spoken turn. */
function updateQuestion(
  segments: TranscriptSegment[],
  itemId: string,
  questionId: string,
  patch: Partial<InterviewQuestion>,
) {
  return segments.map((segment) =>
    segment.itemId === itemId
      ? {
          ...segment,
          questions: segment.questions.map((question) =>
            question.id === questionId ? { ...question, ...patch } : question,
          ),
        }
      : segment,
  );
}

/** Owns system-audio capture, the local proxy socket, and transcript/retrieval state. */
export function useInterviewSession() {
  const [phase, setPhase] = useState(SessionPhase.Idle);
  const [mode, setMode] = useState(RealtimeMode.Translation);
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
        setSegments((values) =>
          updateSegment(values, itemId, mode, { sourceText: event.text ?? "" }),
        );
        break;
      case "source.final":
        setSegments((values) =>
          updateSegment(values, itemId, mode, {
            sourceText: event.text ?? "",
            isSourceFinal: true,
          }),
        );
        break;
      case "translation.partial":
        setSegments((values) =>
          updateSegment(values, itemId, mode, { translatedText: event.text ?? "" }),
        );
        break;
      case "translation.final":
        setSegments((values) =>
          updateSegment(values, itemId, mode, {
            translatedText: event.text ?? "",
            isTranslationFinal: true,
          }),
        );
        break;
      case "questions.updated":
        setSegments((values) =>
          updateSegment(values, itemId, mode, {
            questions: reconcileQuestions(
              values.find((segment) => segment.itemId === itemId)?.questions ?? [],
              event.questions ?? [],
            ),
          }),
        );
        break;
      case "question.knowledge.results": {
        const questionId = event.questionId;
        if (!questionId) {
          break;
        }
        setSegments((values) =>
          updateQuestion(values, itemId, questionId, {
            knowledgeResults: event.results ?? [],
            knowledgeError: undefined,
          }),
        );
        break;
      }
      case "question.knowledge.error": {
        const questionId = event.questionId;
        if (!questionId) {
          break;
        }
        setSegments((values) =>
          updateQuestion(values, itemId, questionId, {
            knowledgeError: event.message,
          }),
        );
        break;
      }
      case "session.finished":
        socketRef.current?.close();
        setPhase(SessionPhase.Idle);
        break;
      case "session.error":
        setErrorMessage(event.message ?? "实时语音服务发生错误。 ");
        setPhase(SessionPhase.Error);
        break;
      case "session.disconnected":
        setErrorMessage("实时语音连接意外中断。 ");
        setPhase(SessionPhase.Error);
        break;
    }
  }, [mode]);

  /** Changes the cloud processing mode only while no capture session is active. */
  const handleModeChange = useCallback(
    (value: RealtimeMode) => {
      if ([SessionPhase.Idle, SessionPhase.Error].includes(phase)) {
        setMode(value);
      }
    },
    [phase],
  );

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
      const query = new URLSearchParams({ mode });
      const socket = new WebSocket(
        `${protocol}//${window.location.host}/api/realtime?${query.toString()}`,
      );
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
        setErrorMessage("无法连接本地实时语音服务。 ");
        setPhase(SessionPhase.Error);
      };
      socketRef.current = socket;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "系统音频授权失败。 ");
      setPhase(SessionPhase.Error);
    }
  }, [handleRealtimeEvent, mode]);

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
    mode,
    segments,
    audioSourceLabel,
    errorMessage,
    start,
    stop,
    clear,
    setMode: handleModeChange,
  };
}
