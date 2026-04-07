import { stripAnsi } from './stripAnsi';

const PROMPT_RE = /(\S+[@:]\S+[\$#%>❯]|[\$#%❯])\s*$/;
const SSH_TARGET_RE = /(\S+)@(\S+?)[\s:]/;
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
type OutputCallback = (output: string) => void;
type AltScreenCallback = (entered: boolean) => void;
type PromptChangeCallback = (prompt: string, isRemote: boolean, sshTarget: string | null) => void;

export class BlockSegmenter {
  private _idCounter: number = 0;
  private _currentPrompt: string = '';
  private _initialPrompt: string = '';
  private _startTime: number = 0;
  private _pendingLines: string[] = [];   // lines after the prompt (stripped)
  private _partialLine: string = '';       // current incomplete line (stripped)

  private _blockCallbacks: BlockCallback[] = [];
  private _outputCallbacks: OutputCallback[] = [];
  private _altScreenCallbacks: AltScreenCallback[] = [];
  private _promptChangeCallbacks: PromptChangeCallback[] = [];

  // Whether we have seen at least one prompt yet
  private _seenFirstPrompt: boolean = false;

  // Whether we are currently in alt-screen mode
  private _inAltScreen: boolean = false;

  private _nextId(): string {
    return `seg-block-${++this._idCounter}`;
  }

  onBlock(cb: BlockCallback): void {
    this._blockCallbacks.push(cb);
  }

  onOutput(cb: OutputCallback): void {
    this._outputCallbacks.push(cb);
  }

  onAltScreen(cb: AltScreenCallback): void {
    this._altScreenCallbacks.push(cb);
  }

  onPromptChange(cb: PromptChangeCallback): void {
    this._promptChangeCallbacks.push(cb);
  }

  get currentPrompt(): string {
    return this._currentPrompt;
  }

  get seenFirstPrompt(): boolean {
    return this._seenFirstPrompt;
  }

  /** Bootstrap the segmenter when the initial prompt was missed (IPC race). */
  bootstrapPrompt(): void {
    if (!this._seenFirstPrompt) {
      this._seenFirstPrompt = true;
      this._startTime = Date.now();
    }
  }

  feed(rawData: string): void {
    // Check for alt screen sequences BEFORE stripping ANSI
    if (rawData.includes(ALT_SCREEN_ENTER)) {
      this._inAltScreen = true;
      this._altScreenCallbacks.forEach((cb) => cb(true));
    }
    if (rawData.includes(ALT_SCREEN_EXIT)) {
      this._inAltScreen = false;
      this._altScreenCallbacks.forEach((cb) => cb(false));
    }

    // Skip all segmentation while in alt-screen mode
    if (this._inAltScreen) return;

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

    // After updating lines, check for a prompt in either the partial line
    // or the last completed line (some shells send the prompt with a trailing newline)
    this._checkForPrompt();

    // Emit streaming output for in-progress commands.
    // Use >= 1 (not > 1) because output may arrive as partial lines (\r without \n)
    // which accumulate in _partialLine rather than _pendingLines.
    if (this._seenFirstPrompt && this._pendingLines.length >= 1) {
      const outputLines = this._pendingLines.slice(1);
      const partialSuffix = this._partialLine ? '\n' + this._partialLine : '';
      const output = outputLines
        .map((l) => l.trimEnd())
        .join('\n')
        .trim() + partialSuffix;
      if (output) {
        this._outputCallbacks.forEach((cb) => cb(output));
      }
    }
  }

  private _checkForPrompt(): void {
    // First check the partial line (prompt sent without trailing newline)
    if (this._partialLine && PROMPT_RE.test(this._partialLine)) {
      this._handlePromptDetected(this._partialLine, 'partial');
      return;
    }

    // Also check the last completed line for a prompt pattern. Some shells
    // send the prompt with a trailing newline, putting it in _pendingLines
    // instead of _partialLine. We only check when _partialLine is empty.
    // After bootstrapping, require multiple pending lines to distinguish
    // a real prompt boundary (with output above it) from an echoed empty
    // command (bare Enter), which is a single prompt-matching line.
    if (this._pendingLines.length > 0 && this._partialLine === '') {
      const lastLine = this._pendingLines[this._pendingLines.length - 1];
      if (PROMPT_RE.test(lastLine) && (!this._seenFirstPrompt || this._pendingLines.length > 1)) {
        this._pendingLines.pop();
        this._handlePromptDetected(lastLine, 'completed');
      }
    }
  }

  private _handlePromptDetected(promptText: string, _source: 'partial' | 'completed'): void {
    const newPromptText = promptText;

    // If we have no pending lines, this is the initial prompt (nothing to emit)
    if (this._pendingLines.length === 0 && !this._seenFirstPrompt) {
      this._seenFirstPrompt = true;
      this._currentPrompt = newPromptText;
      this._initialPrompt = newPromptText;
      this._startTime = Date.now();
      this._partialLine = '';
      this._firePromptChange(newPromptText);
      return;
    }

    // Guard: skip emission when pendingLines is empty and we've already seen the
    // first prompt — this handles spurious double-prompt (e.g. terminal resize)
    // where no actual command was typed.
    if (this._pendingLines.length === 0 && this._seenFirstPrompt) {
      const changed = newPromptText !== this._currentPrompt;
      this._currentPrompt = newPromptText;
      this._startTime = Date.now();
      this._partialLine = '';
      if (changed) this._firePromptChange(newPromptText);
      return;
    }

    // We have pending content — emit a block
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
      id: this._nextId(),
      command,
      output,
      promptText: this._currentPrompt,
      startTime: this._startTime,
      duration: Date.now() - this._startTime,
      isRemote: (() => {
        const initId = this._extractIdentity(this._initialPrompt);
        const newId = this._extractIdentity(newPromptText);
        return this._initialPrompt !== '' && (
          (initId !== null && newId !== null && newId !== initId) ||
          (initId === null && newId !== null && newPromptText !== this._initialPrompt)
        );
      })(),
    };

    this._blockCallbacks.forEach((cb) => cb(block));

    // Transition to new prompt state
    this._currentPrompt = newPromptText;
    this._startTime = Date.now();
    this._pendingLines = [];
    this._partialLine = '';
    this._firePromptChange(newPromptText);
  }

  /**
   * Extract the user@host identity from a prompt string.
   * Returns e.g. "michaelstephens@Michaels-Mac-mini" or null.
   */
  private _extractIdentity(prompt: string): string | null {
    const m = prompt.match(SSH_TARGET_RE);
    return m ? `${m[1]}@${m[2]}` : null;
  }

  private _firePromptChange(prompt: string): void {
    // Compare user@host identity rather than full prompt text,
    // since the prompt changes with cwd, venv activation, etc.
    const initialId = this._extractIdentity(this._initialPrompt);
    const currentId = this._extractIdentity(prompt);
    // Remote if: identities differ, or a user@host appeared when initial had none
    const isRemote = this._initialPrompt !== '' && (
      (initialId !== null && currentId !== null && currentId !== initialId) ||
      (initialId === null && currentId !== null && prompt !== this._initialPrompt)
    );
    const sshTarget = isRemote && currentId ? currentId : null;
    this._promptChangeCallbacks.forEach((cb) => cb(prompt, isRemote, sshTarget));
  }

  reset(): void {
    this._currentPrompt = '';
    this._initialPrompt = '';
    this._startTime = 0;
    this._pendingLines = [];
    this._partialLine = '';
    this._seenFirstPrompt = false;
    this._inAltScreen = false;
    this._blockCallbacks = [];
    this._outputCallbacks = [];
    this._altScreenCallbacks = [];
    this._promptChangeCallbacks = [];
  }
}
