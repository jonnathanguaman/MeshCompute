export function LoadingState({ label = 'Loading MeshCompute…' }: { label?: string }) {
  return <div className="loading-state"><span className="loading-orbit" /><p>{label}</p></div>;
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return <div className="error-state"><span>!</span><div><h2>{title}</h2><p>{message}</p>{onRetry && <button className="button button-secondary button-small" onClick={onRetry}>Try again</button>}</div></div>;
}
