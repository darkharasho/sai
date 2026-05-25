interface Props {
  toolName: string;
  command?: string;
  input?: Record<string, unknown>;
  onDecide: (decision: 'approve' | 'deny', modifiedCommand?: string) => void;
}

export default function Approval({ toolName, command, input, onDecide }: Props) {
  return (
    <div className="border border-amber-700 bg-amber-950/30 rounded-md p-3 my-2 text-sm space-y-2">
      <div className="font-semibold">Approval needed: <span className="font-mono">{toolName}</span></div>
      {command && <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-neutral-950 p-2 rounded">{command}</pre>}
      {!command && input && <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-neutral-950 p-2 rounded">{JSON.stringify(input, null, 2)}</pre>}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onDecide('approve')}
          className="px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-xs"
        >Allow</button>
        <button
          onClick={() => onDecide('deny')}
          className="px-3 py-1 rounded bg-neutral-800 hover:bg-red-700 text-xs"
        >Deny</button>
      </div>
    </div>
  );
}
