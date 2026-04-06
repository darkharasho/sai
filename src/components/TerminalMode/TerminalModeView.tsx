import { useState, useRef, useEffect, useCallback } from 'react';
import TerminalModeBlockList from './TerminalModeBlockList';
import TerminalModeInput from './TerminalModeInput';
import TerminalModeEditor from './TerminalModeEditor';
import { stripAnsi } from './stripAnsi';
import type { Block, CommandBlock as CommandBlockType, ApprovalBlock as ApprovalBlockType, InputMode } from './types';

// Reuse the prompt regex from terminalBuffer.ts
const PROMPT_RE = /^(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s/;
const EXIT_MARKER_RE = /__EXIT:(\d+)__/;

interface TerminalModeViewProps {
  projectPath: string;
}

let blockIdCounter = 0;
function nextBlockId(): string {
  return `tm-${++blockIdCounter}`;
}

let groupIdCounter = 0;
function nextGroupId(): string {
  return `grp-${++groupIdCounter}`;
}

export default function TerminalModeView({ projectPath }: TerminalModeViewProps) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>('shell');
  const [editValue, setEditValue] = useState<string | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);

  // Editor panel state
  const [editorFiles, setEditorFiles] = useState<{ path: string; content: string; highlightLine?: number }[]>([]);
  const [activeEditorFile, setActiveEditorFile] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const ptyIdRef = useRef<number | null>(null);
  const activeBlockRef = useRef<string | null>(null);
  const outputBufferRef = useRef('');
  const startTimeRef = useRef(0);
  const currentGroupRef = useRef<string>(nextGroupId());

  // Create PTY on mount
  useEffect(() => {
    let cleanupData: (() => void) | null = null;

    const init = async () => {
      const id = await window.sai.terminalCreate(projectPath);
      ptyIdRef.current = id;

      cleanupData = window.sai.terminalOnData((ptyId: number, data: string) => {
        if (ptyId !== ptyIdRef.current) return;
        if (!activeBlockRef.current) return;

        const stripped = stripAnsi(data);
        outputBufferRef.current += stripped;

        // Check for exit marker
        const exitMatch = outputBufferRef.current.match(EXIT_MARKER_RE);
        if (exitMatch) {
          const exitCode = parseInt(exitMatch[1], 10);
          const duration = Date.now() - startTimeRef.current;

          // Clean up the output: remove the echoed command, exit marker, and trailing prompt
          let output = outputBufferRef.current;
          output = output.replace(EXIT_MARKER_RE, '');
          // Remove trailing prompt line
          const lines = output.split('\n');
          while (lines.length > 0 && PROMPT_RE.test(lines[lines.length - 1])) {
            lines.pop();
          }
          // Remove leading echoed command line
          if (lines.length > 0) lines.shift();
          output = lines.join('\n').trim();

          const blockId = activeBlockRef.current;
          setBlocks(prev => prev.map(b =>
            b.id === blockId && b.type === 'command'
              ? { ...b, output, exitCode, duration }
              : b
          ));
          activeBlockRef.current = null;
          outputBufferRef.current = '';
          setIsRunning(false);
        }
      });
    };

    init();

    return () => {
      cleanupData?.();
      if (ptyIdRef.current !== null) {
        window.sai.terminalKill(ptyIdRef.current);
      }
    };
  }, [projectPath]);

  const executeCommand = useCallback((command: string) => {
    if (ptyIdRef.current === null || isRunning) return;

    const blockId = nextBlockId();
    const block: CommandBlockType = {
      type: 'command',
      id: blockId,
      command,
      output: '',
      exitCode: null,
      startTime: Date.now(),
      duration: null,
      groupId: currentGroupRef.current,
    };

    setBlocks(prev => [...prev, block]);
    activeBlockRef.current = blockId;
    outputBufferRef.current = '';
    startTimeRef.current = Date.now();
    setIsRunning(true);

    // Write command with exit code marker appended
    window.sai.terminalWrite(ptyIdRef.current, `${command}; echo __EXIT:$?__\n`);
  }, [isRunning]);

  const handleSubmit = useCallback((value: string) => {
    if (inputMode === 'shell') {
      executeCommand(value);
      setEditValue(undefined);
    } else {
      // AI mode — send to Claude and handle response
      currentGroupRef.current = nextGroupId();
      handleAIRequest(value);
    }
  }, [inputMode, executeCommand]);

  const handleAIRequest = useCallback((prompt: string) => {
    // Send the prompt to the AI provider
    window.sai.claudeSend(projectPath, prompt, undefined, 'default', 'high', 'sonnet');

    const aiBlockId = nextBlockId();
    setBlocks(prev => [...prev, {
      type: 'ai-response' as const,
      id: aiBlockId,
      content: '',
      parentBlockId: prev.length > 0 ? prev[prev.length - 1].id : '',
    }]);

    // Listen for streaming response
    const cleanup = window.sai.claudeOnMessage((msg: any) => {
      if (msg.projectPath && msg.projectPath !== projectPath) return;

      if (msg.type === 'assistant' && msg.message) {
        setBlocks(prev => prev.map(b =>
          b.id === aiBlockId && b.type === 'ai-response'
            ? { ...b, content: b.content + msg.message }
            : b
        ));
      }

      if (msg.type === 'done') {
        cleanup();
        // Check if the AI response contains a suggested command (fenced bash block)
        setBlocks(prev => {
          const aiBlock = prev.find(b => b.id === aiBlockId);
          if (!aiBlock || aiBlock.type !== 'ai-response') return prev;

          const bashMatch = aiBlock.content.match(/```(?:bash|sh|shell)\n([\s\S]*?)```/);
          if (bashMatch) {
            const suggestedCmd = bashMatch[1].trim();
            return [...prev, {
              type: 'approval' as const,
              id: nextBlockId(),
              command: suggestedCmd,
              parentBlockId: aiBlockId,
              status: 'pending' as const,
            }];
          }
          return prev;
        });
      }
    });
  }, [projectPath]);

  const handleAskAI = useCallback((block: CommandBlockType) => {
    currentGroupRef.current = nextGroupId();
    const prompt = `The following command ${block.exitCode === 0 ? 'succeeded' : 'failed'} with exit code ${block.exitCode}:\n\n\`\`\`\n$ ${block.command}\n${block.output}\n\`\`\`\n\nAnalyze this and suggest a fix if needed. If you suggest a command, put it in a \`\`\`bash code block.`;
    handleAIRequest(prompt);
  }, [handleAIRequest]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleRerun = useCallback((command: string) => {
    executeCommand(command);
  }, [executeCommand]);

  const handleApprove = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'approved' as const } : b
    ));
    currentGroupRef.current = nextGroupId();
    executeCommand(block.command);
  }, [executeCommand]);

  const handleReject = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'rejected' as const } : b
    ));
  }, []);

  const handleEdit = useCallback((block: ApprovalBlockType) => {
    setBlocks(prev => prev.map(b =>
      b.id === block.id ? { ...b, status: 'edited' as const } : b
    ));
    setEditValue(block.command);
    setInputMode('shell');
  }, []);

  const toggleMode = useCallback(() => {
    setInputMode(prev => prev === 'shell' ? 'ai' : 'shell');
  }, []);

  const openFileInEditor = useCallback(async (filePath: string, line?: number) => {
    const absPath = filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
    const content = await window.sai.readFile(absPath);
    if (content === null) return;

    setEditorFiles(prev => {
      const existing = prev.find(f => f.path === absPath);
      if (existing) {
        return prev.map(f => f.path === absPath ? { ...f, highlightLine: line } : f);
      }
      return [...prev, { path: absPath, content, highlightLine: line }];
    });
    setActiveEditorFile(absPath);
    setEditorOpen(true);
  }, [projectPath]);

  return (
    <div className="tm-view">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TerminalModeBlockList
          blocks={blocks}
          onCopy={handleCopy}
          onAskAI={handleAskAI}
          onRerun={handleRerun}
          onApprove={handleApprove}
          onReject={handleReject}
          onEdit={handleEdit}
        />
        <TerminalModeInput
          onSubmit={handleSubmit}
          mode={inputMode}
          onToggleMode={toggleMode}
          initialValue={editValue}
          disabled={isRunning}
        />
      </div>
      {editorOpen && (
        <TerminalModeEditor
          files={editorFiles}
          activeFile={activeEditorFile}
          onSelectFile={setActiveEditorFile}
          onClose={() => setEditorOpen(false)}
        />
      )}

      <style>{`
        .tm-view {
          flex: 1;
          display: flex;
          flex-direction: row;
          background: var(--bg);
          min-width: 0;
        }
      `}</style>
    </div>
  );
}
