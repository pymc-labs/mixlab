'use client';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, ChevronRight, Settings2, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  claudeProvider,
  openAIProvider,
  describeAction,
  validateAction,
  type AgentAction,
  type AgentMessage,
} from '@/lib/agent';

type Props = {
  context: unknown;
  revision: string;
  busy: boolean;
  onAction: (a: AgentAction) => Promise<unknown>;
  onClose: () => void;
};
type Entry = { role: string; text: string };
export function Investigation({
  context,
  revision,
  busy,
  onAction,
  onClose,
}: Props) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [input, setInput] = useState('');
  const [settings, setSettings] = useState(false),
    [key, setKey] = useState(''),
    [model, setModel] = useState('claude-sonnet-4-6');
  const [providerName, setProviderName] = useState<'anthropic' | 'openai'>(
    'anthropic',
  );
  const providerLabel = providerName === 'openai' ? 'OpenAI' : 'Anthropic';
  const [running, setRunning] = useState(false),
    [error, setError] = useState('');
  const [pending, setPending] = useState<{
    action: AgentAction;
    revision: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const live = useRef({ context, revision, busy, onAction });
  live.current = { context, revision, busy, onAction };
  const conversation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = conversation.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [entries, pending, running, error, busy]);
  const history = useRef<AgentMessage[]>([]),
    abort = useRef<AbortController | null>(null),
    locked = useRef(false);
  const add = (role: string, text: string) =>
    setEntries((e) => [...e, { role, text }]);
  useEffect(() => () => abort.current?.abort(), []);
  async function send(text: string) {
    if (!text.trim() || locked.current) return;
    if (!key.trim()) {
      setInput(text);
      setSettings(true);
      return;
    }
    locked.current = true;
    setRunning(true);
    setError('');
    setInput('');
    add('You', text);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const messages: AgentMessage[] = [
      ...history.current,
      { role: 'user', content: text },
    ];
    try {
      const provider = (
        providerName === 'openai' ? openAIProvider : claudeProvider
      )(key.trim(), model.trim());
      for (let step = 0; step < 8; step++) {
        const blocks = await provider.respond(
          messages,
          live.current.context,
          ctrl.signal,
        );
        messages.push({ role: 'assistant', content: blocks });
        for (const b of blocks) if (b.type === 'text') add('Mixlab', b.text);
        const calls = blocks.filter((b) => b.type === 'tool_use');
        if (!calls.length) {
          history.current = messages;
          return;
        }
        const results: import('@/lib/agent').Block[] = [];
        for (const call of calls) {
          if (call.type !== 'tool_use') continue;
          if (ctrl.signal.aborted)
            throw new DOMException('Stopped', 'AbortError');
          try {
            let result: unknown;
            if (call.name === 'inspect_workspace')
              result = live.current.context;
            else if (call.name === 'workspace_action') {
              const action = validateAction(call.input),
                proposedRevision = live.current.revision;
              const approved = await new Promise<boolean>((resolve) => {
                const cancel = () => resolve(false);
                ctrl.signal.addEventListener('abort', cancel, { once: true });
                setPending({
                  action,
                  revision: proposedRevision,
                  resolve: (ok) => {
                    ctrl.signal.removeEventListener('abort', cancel);
                    resolve(ok);
                  },
                });
              });
              setPending(null);
              if (ctrl.signal.aborted)
                throw new DOMException('Stopped', 'AbortError');
              if (!approved) result = { declined: true };
              else if (live.current.revision !== proposedRevision)
                result = {
                  error:
                    'Workspace changed since proposal. Read current state and propose again.',
                };
              else {
                add('Action', describeAction(action));
                result = await live.current.onAction(action);
                add(
                  'Result',
                  action.kind === 'python_output'
                    ? 'Reviewed Python output shared with your AI provider.'
                    : typeof result === 'string'
                      ? result
                      : JSON.stringify(result),
                );
                await new Promise<void>((resolve) =>
                  requestAnimationFrame(() => resolve()),
                );
              }
            } else throw Error('Unknown tool.');
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: JSON.stringify(result),
            });
          } catch (e) {
            if (ctrl.signal.aborted) throw e;
            const message = e instanceof Error ? e.message : String(e);
            add('Action failed', message);
            results.push({
              type: 'tool_result',
              tool_use_id: call.id,
              content: message,
              is_error: true,
            });
          }
        }
        messages.push({ role: 'user', content: results });
      }
      history.current = messages;
      add(
        'Mixlab',
        'Reached the eight-step limit. You can continue with another message.',
      );
    } catch (e) {
      setError(
        ctrl.signal.aborted
          ? 'Assistant stopped. Completed workspace actions are kept. Any running fit can be stopped in the workbench.'
          : e instanceof Error
            ? e.message
            : String(e),
      );
      // Keep only complete prior turns so an interrupted tool call never corrupts the protocol.
    } finally {
      locked.current = false;
      setRunning(false);
      setPending(null);
      abort.current = null;
    }
  }
  return (
    <aside className="investigation-agent" aria-label="Investigation assistant">
      <div className="agent-heading">
        <div>
          <Sparkles size={18} />
          <strong>Investigate together</strong>
        </div>
        <div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Assistant settings"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={17} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Hide assistant"
            onClick={onClose}
          >
            <X size={17} />
          </Button>
        </div>
      </div>
      <div className="agent-context">
        <span className="status-dot" /> Shared with your workbench ·{' '}
        {key ? `${providerLabel} connected` : 'AI not connected'}
      </div>
      <div
        ref={conversation}
        className="agent-conversation"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        <div className="agent-welcome">
          <div className="eyebrow">A QUESTION TO START WITH</div>
          <h2>How much can we trust this mix?</h2>
          <p>
            Explore the data, make assumptions explicit, and test what changes
            the answer.
          </p>
        </div>
        {!entries.length && (
          <div className="agent-starters">
            {[
              'Guide me through this dataset.',
              'Help me choose sensible priors.',
              'Check how robust my results are.',
            ].map((text) => (
              <button key={text} onClick={() => void send(text)}>
                {text}
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        )}
        {entries.map((e, i) => (
          <article
            className={`agent-entry ${e.role === 'You' ? 'from-user' : ''}`}
            key={i}
          >
            <strong>{e.role}</strong>
            {e.role === 'Mixlab' ? (
              <div className="agent-markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    table: ({ children }) => (
                      <div
                        className="agent-table-scroll"
                        tabIndex={0}
                        role="region"
                        aria-label="Table"
                      >
                        <table>{children}</table>
                      </div>
                    ),
                    a: ({ children, href }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {e.text}
                </Markdown>
              </div>
            ) : (
              <p>{e.text}</p>
            )}
          </article>
        ))}
        {pending && (
          <div className="agent-proposal">
            <div className="eyebrow">PROPOSED NEXT STEP</div>
            <pre>{describeAction(pending.action)}</pre>
            {pending.action.kind === 'fit' && (
              <p>This starts a local fit using the sampling budget in Model.</p>
            )}
            {pending.action.kind === 'configure' && (
              <p>This changes your draft. Fit again to obtain new results.</p>
            )}
            {pending.revision !== revision && (
              <p>
                The workbench changed. Decline this proposal and ask for an
                updated one.
              </p>
            )}
            <Button
              disabled={busy || pending.revision !== revision}
              onClick={() => pending.resolve(true)}
            >
              Apply
            </Button>
            <Button variant="ghost" onClick={() => pending.resolve(false)}>
              Decline
            </Button>
          </div>
        )}
        {running && !pending && (
          <p className="agent-status" role="status">
            {busy ? 'Waiting for the local fit…' : 'Working on your question…'}
          </p>
        )}
        {error && (
          <p role="alert" className="agent-error">
            {error}
          </p>
        )}
      </div>
      <form
        className="agent-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Textarea
          aria-label="Message to assistant"
          placeholder="Ask a question or delegate a step…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              if (!e.repeat) void send(input);
            }
          }}
          aria-describedby="agent-keyboard-hint"
        />
        <p id="agent-keyboard-hint" className="agent-keyboard-hint">
          Enter to send · Shift+Enter for a new line
        </p>
        <div>
          <span>
            {key
              ? `Messages & summaries go to ${providerLabel}`
              : 'Connect your own key to start'}{' '}
          </span>
          {running ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => abort.current?.abort()}
            >
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              aria-label="Send message"
            >
              <ArrowUp size={18} />
            </Button>
          )}
        </div>
      </form>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogTitle>Connect your AI assistant</DialogTitle>
          <DialogDescription>
            Your messages, column labels, validation notes, model settings,
            custom Python source and result summaries are sent directly to{' '}
            {providerLabel}. Raw CSV rows and posterior draws are excluded
            automatically. Python output is shared only after a separate review;
            code may include any values you put into it. Anything you type in
            chat is sent. API usage is billed to your account.
          </DialogDescription>
          <label htmlFor="agent-provider">AI provider</label>
          <Select
            value={providerName}
            disabled={running}
            onValueChange={(v) => {
              if (v !== 'openai' && v !== 'anthropic') return;
              if (v === providerName) return;
              setProviderName(v);
              setKey('');
              setModel(v === 'openai' ? 'gpt-5.4' : 'claude-sonnet-4-6');
              history.current = [];
              setEntries([]);
              setError('');
            }}
          >
            <SelectTrigger id="agent-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic · Claude</SelectItem>
              <SelectItem value="openai">OpenAI · GPT</SelectItem>
            </SelectContent>
          </Select>
          <p>
            Switching providers clears the key and conversation, so previous
            messages are not sent to a different provider.
          </p>
          <label htmlFor="agent-key">Your API key</label>
          <Input
            id="agent-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={running}
            placeholder={providerName === 'openai' ? 'sk-…' : 'sk-ant-…'}
          />
          <label htmlFor="agent-model">Model</label>
          <Input
            id="agent-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={running}
          />
          <p>
            The key is kept in this page’s memory and sent only to your selected
            provider for authentication. It is cleared on reload. Only connect
            on a deployment you trust. The conversation also lasts for this page
            session.
          </p>
          <Button
            disabled={!key.trim() || !model.trim() || running}
            onClick={() => setSettings(false)}
          >
            Use this connection
          </Button>
          <Button
            variant="ghost"
            disabled={running}
            onClick={() => {
              setKey('');
              history.current = [];
              setEntries([]);
              setSettings(false);
            }}
          >
            Disconnect & clear conversation
          </Button>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
