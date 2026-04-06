import { stripAnsi } from './stripAnsi';

const PROMPT_RE = /(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s*$/;
const ALT_SCREEN_ENTER = '\x1b[?1049h';
const ALT_SCREEN_EXIT = '\x1b[?1049l';

export interface SegmentedBlock {
  id: string;
  command: string;
  output: string;
  promptText: string;
  startTime: number;
  duration: number;
  isRemote: boolean;
}

type BlockCallback = (block: SegmentedBlock) => void;
type AltScreenCallback = (entered: boolean) => void;

let idCounter = 0;
function nextId(): string {
  return `seg-block-${++idCounter}`;
}

export class BlockSegmenter {
  private _currentPrompt: string = '';
  private _startTime: number = 0;
  private _pendingLines: string[] = [];   // lines after the prompt (stripped)
  private _partialLine: string = '';       // current incomplete line (stripped)

  private _blockCallbacks: BlockCallback[] = [];
  private _altScreenCallbacks: AltScreenCallback[] = [];

  // Whether we have seen at least one prompt yet
  private _seenFirstPrompt: boolean = false;

  onBlock(cb: BlockCallback): void {
    this._blockCallbacks.push(cb);
  }

  onAltScreen(cb: AltScreenCallback): void {
    this._altScreenCallbacks.push(cb);
  }

  get currentPrompt(): string {
    return this._currentPrompt;
  }

  feed(rawData: string): void {
    // Check for alt screen sequences BEFORE stripping ANSI
    if (rawData.includes(ALT_SCREEN_ENTER)) {
      this._altScreenCallbacks.forEach((cb) => cb(true));
    }
    if (rawData.includes(ALT_SCREEN_EXIT)) {
      this._altScreenCallbacks.forEach((cb) => cb(false));
    }

    const clean = stripAnsi(rawData);

    // Split into parts on newlines, but keep the structure:
    // everything up to (and not including) the last newline are complete lines;
    // everything after the last newline is a partial line.
    const newlineIndex = clean.lastIndexOf('\n');

    if (newlineIndex === -1) {
      // No newline — all partial
      this._partialLine += clean;
    } else {
      // There are complete lines
      const completeChunk = clean.substring(0, newlineIndex);
      const remainder = clean.substring(newlineIndex + 1);

      const newCompleteLines = (this._partialLine + completeChunk).split('\n');
      this._partialLine = remainder;

      for (const line of newCompleteLines) {
        this._pendingLines.push(line);
      }
    }

    // After updating the partial line, check if it looks like a prompt
    this._checkPartialForPrompt();
  }

  private _checkPartialForPrompt(): void {
    const candidate = this._partialLine;
    if (!PROMPT_RE.test(candidate)) {
      return;
    }

    // We have a new prompt
    const newPromptText = candidate;

    // If we have no pending lines, this is the initial prompt (nothing to emit)
    if (this._pendingLines.length === 0 && !this._seenFirstPrompt) {
      this._seenFirstPrompt = true;
      this._currentPrompt = newPromptText;
      this._startTime = Date.now();
      this._partialLine = '';
      return;
    }

    // We have pending content OR we've already seen the first prompt — emit a block
    this._seenFirstPrompt = true;
    this._finalizeBlock(newPromptText);
  }

  private _finalizeBlock(newPromptText: string): void {
    const lines = this._pendingLines;

    // The first pending line is the echoed command (the line that followed the
    // previous prompt). Extract it by stripping the prompt text from the front.
    let command = '';
    let outputLines: string[] = [];

    if (lines.length > 0) {
      const firstLine = lines[0];
      // The echoed command line may include the prompt text at the start.
      // First try to strip the known current prompt prefix.
      const strippedPrompt = this._currentPrompt.trimEnd();
      if (strippedPrompt && firstLine.startsWith(strippedPrompt)) {
        command = firstLine.slice(strippedPrompt.length).trim();
      } else {
        // No known prompt prefix — strip prompt via regex match at line start
        const promptMatch = firstLine.match(/^(?:\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s*/);
        if (promptMatch) {
          command = firstLine.slice(promptMatch[0].length).trim();
        } else {
          command = firstLine.trim();
        }
      }
      outputLines = lines.slice(1);
    }

    const output = outputLines
      .map((l) => l.trimEnd())
      .join('\n')
      .trim();

    const block: SegmentedBlock = {
      id: nextId(),
      command,
      output,
      promptText: this._currentPrompt,
      startTime: this._startTime,
      duration: Date.now() - this._startTime,
      isRemote: newPromptText.includes('@') &&
        this._currentPrompt.includes('@') &&
        newPromptText.split('@')[1]?.split(':')[0] !==
          this._currentPrompt.split('@')[1]?.split(':')[0],
    };

    this._blockCallbacks.forEach((cb) => cb(block));

    // Transition to new prompt state
    this._currentPrompt = newPromptText;
    this._startTime = Date.now();
    this._pendingLines = [];
    this._partialLine = '';
  }

  reset(): void {
    this._currentPrompt = '';
    this._startTime = 0;
    this._pendingLines = [];
    this._partialLine = '';
    this._seenFirstPrompt = false;
  }
}
