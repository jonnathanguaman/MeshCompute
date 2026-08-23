import type { ToolTraceItem } from '@meshcompute/contracts';
import { Check, RotateCcw, ShieldX, Wrench, X } from 'lucide-react';

export function ToolTrace({ trace }: { trace: ToolTraceItem[] }) {
  if (!trace.length) return <p className="muted-copy">No tool calls were required.</p>;
  return (
    <div className="tool-trace">
      {trace.map((item, index) => {
        const success = item.executionStatus === 'SUCCESS';
        return (
          <div className="tool-row" key={`${item.turn}-${item.toolName}-${index}`}>
            <span className="tool-index">{item.turn}</span>
            <span className="tool-icon">{success ? <Wrench size={15} /> : <ShieldX size={15} />}</span>
            <div className="tool-name"><strong>{item.toolName}</strong>{item.errorCode && <small>{item.errorCode}</small>}</div>
            {item.retryCount > 0 && <span className="tool-retry"><RotateCcw size={12} /> retry {item.retryCount}</span>}
            <span className="tool-duration">{item.durationMs} ms</span>
            <span className={success ? 'tool-result tool-success' : 'tool-result tool-error'}>
              {success ? <Check size={13} /> : <X size={13} />}{item.executionStatus.toLowerCase()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
