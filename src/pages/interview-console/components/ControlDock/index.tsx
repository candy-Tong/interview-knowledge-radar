import { AudioLines, CircleStop, Languages, Radio, RotateCcw } from "lucide-react";
import { RealtimeMode, SessionPhase } from "../../types";
import "./style.css";

type ControlDockProps = {
  phase: SessionPhase;
  mode: RealtimeMode;
  audioSourceLabel: string;
  canStart: boolean;
  errorMessage: string;
  readinessMessage: string;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onClear: () => void;
  onModeChange: (mode: RealtimeMode) => void;
};

const phaseLabelMap: Record<SessionPhase, string> = {
  [SessionPhase.Idle]: "待命",
  [SessionPhase.Connecting]: "连接中",
  [SessionPhase.Listening]: "监听系统音频",
  [SessionPhase.HearingSpeech]: "检测到面试官语音",
  [SessionPhase.Finishing]: "正在收尾",
  [SessionPhase.Error]: "需要检查",
};

/** Keeps the high-stakes capture actions explicit and visually distinct. */
export function ControlDock({
  phase,
  mode,
  audioSourceLabel,
  canStart,
  errorMessage,
  readinessMessage,
  onStart,
  onStop,
  onClear,
  onModeChange,
}: ControlDockProps) {
  const isActive = ![SessionPhase.Idle, SessionPhase.Error].includes(phase);
  return (
    <div className="control-dock">
      <div aria-label="实时语音模式" className="mode-switch" role="group">
        <button
          aria-pressed={mode === RealtimeMode.Translation}
          className={mode === RealtimeMode.Translation ? "is-active" : ""}
          disabled={isActive}
          onClick={() => onModeChange(RealtimeMode.Translation)}
          title="英文识别并调用实时翻译 API 输出中文"
          type="button"
        >
          <Languages size={12} />
          <span>翻译模式</span>
        </button>
        <button
          aria-pressed={mode === RealtimeMode.Transcription}
          className={mode === RealtimeMode.Transcription ? "is-active is-transcription" : ""}
          disabled={isActive}
          onClick={() => onModeChange(RealtimeMode.Transcription)}
          title="只调用实时语音识别 API，不调用翻译模型"
          type="button"
        >
          <AudioLines size={12} />
          <span>普通模式</span>
        </button>
      </div>
      <div className="capture-state">
        <span className={`state-light ${isActive ? "is-active" : ""}`} />
        <div>
          <strong>{phaseLabelMap[phase]}</strong>
          <small>{errorMessage || audioSourceLabel || readinessMessage}</small>
        </div>
      </div>
      <div className="dock-actions">
        <button aria-label="清空当前会话" className="clear-button" onClick={onClear} type="button">
          <RotateCcw size={15} />
          <span>清空</span>
        </button>
        {isActive ? (
          <button
            aria-label="结束系统音频监听"
            className="capture-button stop"
            onClick={() => void onStop()}
            type="button"
          >
            <CircleStop size={18} />
            <span>结束</span>
          </button>
        ) : (
          <button
            aria-label={canStart ? "监听系统音频" : "监听配置未完成"}
            className="capture-button"
            disabled={!canStart}
            onClick={() => void onStart()}
            type="button"
          >
            <Radio size={18} />
            <span>{canStart ? "监听系统音频" : "配置未完成"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
