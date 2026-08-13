import { CircleStop, Radio, RotateCcw } from "lucide-react";
import { SessionPhase } from "../../types";
import "./style.css";

type ControlDockProps = {
  phase: SessionPhase;
  audioSourceLabel: string;
  canStart: boolean;
  errorMessage: string;
  readinessMessage: string;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onClear: () => void;
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
  audioSourceLabel,
  canStart,
  errorMessage,
  readinessMessage,
  onStart,
  onStop,
  onClear,
}: ControlDockProps) {
  const isActive = ![SessionPhase.Idle, SessionPhase.Error].includes(phase);
  return (
    <div className="control-dock">
      <div className="capture-state">
        <span className={`state-light ${isActive ? "is-active" : ""}`} />
        <div>
          <strong>{phaseLabelMap[phase]}</strong>
          <small>{errorMessage || audioSourceLabel || readinessMessage}</small>
        </div>
      </div>
      <div className="dock-actions">
        <button className="clear-button" onClick={onClear} type="button">
          <RotateCcw size={15} />
          清空
        </button>
        {isActive ? (
          <button className="capture-button stop" onClick={() => void onStop()} type="button">
            <CircleStop size={18} />
            结束
          </button>
        ) : (
          <button
            className="capture-button"
            disabled={!canStart}
            onClick={() => void onStart()}
            type="button"
          >
            <Radio size={18} />
            {canStart ? "监听系统音频" : "配置未完成"}
          </button>
        )}
      </div>
    </div>
  );
}
