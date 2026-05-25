interface Props {
  deviceLabel: string;
  serverUrl: string;
  wsState: 'opening' | 'open' | 'closed';
  onDisconnect: () => void;
}

export default function Status({ deviceLabel, serverUrl, wsState, onDisconnect }: Props) {
  const dot = wsState === 'open' ? 'bg-green-500' : wsState === 'opening' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-4">
      <div className="text-4xl">✓</div>
      <h1 className="text-2xl font-semibold">Paired</h1>
      <p className="text-sm text-neutral-400">{deviceLabel}</p>
      <div className="flex items-center gap-2 text-sm">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <span>{wsState}</span>
        <span className="text-neutral-500">·</span>
        <span className="text-neutral-400">{serverUrl}</span>
      </div>
      <button
        onClick={onDisconnect}
        className="mt-8 px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-sm"
      >
        Disconnect
      </button>
    </div>
  );
}
