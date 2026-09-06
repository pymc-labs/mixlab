'use client';
import { usePythonWorkspace } from '../hooks/use-python-workspace';
import { summarizeAgentData } from '../lib/agent-data';
import { Investigation } from '../components/investigation';
import { validateAction, type AgentAction } from '../lib/agent';
import { AllocationPlanner } from '../components/allocation-planner';
import { PriorEditor } from '../components/prior-editor';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  ArrowRight,
  Database,
  Download,
  FlaskConical,
  Layers3,
  LockKeyhole,
  Play,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
  Check,
  TriangleAlert,
  Code2,
  RotateCcw,
  LoaderCircle,
  CircleHelp,
  FileJson,
  CheckCheck,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RevenueChart, Histogram, ResponseCurve } from '@/components/charts';
import {
  canonicalCSV,
  colors,
  compact,
  defaultConfig,
  download,
  healthy,
  inferMapping,
  label,
  number,
  parseCSV,
  scenario,
  validate,
  type Config,
  type Dataset,
  type Mapping,
  type Posterior,
  type RawTable,
} from '@/lib/core';
import { fit, type ProgressState, type Trace } from '@/lib/engine';
import demo from '@/lib/demo.json';
import {
  modelSource,
  pythonScript,
  notebook,
  labPayload,
  readProject,
  SOURCE_URL,
  NOTEBOOK_URL,
} from '@/lib/exports';

const example: RawTable = {
  name: demo.name,
  headers: Object.keys(demo.rows[0]),
  rows: demo.rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])),
  ),
  example: true,
};
const emptyProgress: ProgressState = {
  phase: 'Preparing your model',
  percent: null,
  chain: 0,
  retained: 0,
  alpha: [],
};
function Picker({
  value,
  options,
  onChange,
  id,
  disabled = false,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="picker">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((v) => (
          <SelectItem value={v} key={v}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Range({
  name,
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  suffix = '',
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <div className="range-control">
      <div>
        <span>{name}</span>
        <output>
          {value}
          {suffix}
        </output>
      </div>
      <Slider
        aria-label={name}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        disabled={disabled}
      />
    </div>
  );
}
function ThinPosterior(p: Posterior): Posterior {
  const idx = Array.from({ length: Math.min(400, p.alpha.length) }, (_, i) =>
    Math.floor((i * p.alpha.length) / Math.min(400, p.alpha.length)),
  );
  return {
    ...p,
    predictiveMean: p.predictiveMean
      ? idx.map((i) => p.predictiveMean![i])
      : undefined,
    alpha: idx.map((i) => p.alpha[i]),
    beta: idx.map((i) => p.beta[i]),
    lam: idx.map((i) => p.lam[i]),
  };
}

export default function Home() {
  const [focusNote, setFocusNote] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  function focusWorkspace(view: string) {
    setTab(view);
    setFocusNote(view);
    setFocusTick((n) => n + 1);
    requestAnimationFrame(() =>
      document.getElementById('workbench-focus')?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      }),
    );
  }
  const [agentOpen, setAgentOpen] = useState(true);
  const [savedFits, setSavedFits] = useState<
    { id: number; dataset: string; config: Config; posterior: Posterior }[]
  >([]);
  const fitId = useRef(0);
  const [tab, setTab] = useState('overview'),
    [table, setTable] = useState<RawTable>(example),
    [mapping, setMapping] = useState<Mapping>(inferMapping(example)),
    [config, setConfig] = useState<Config>(defaultConfig);
  const [posterior, setPosterior] = useState<Posterior | null>(null),
    [traces, setTraces] = useState<Trace[]>([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<ProgressState>(emptyProgress),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [lastYear, setLastYear] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [aboutOpen, setAboutOpen] = useState(false),
    [multipliers, setMultipliers] = useState<number[]>([]);
  const [hydrated, setHydrated] = useState(false),
    [saveStatus, setSaveStatus] = useState('loading'),
    [pasteOpen, setPasteOpen] = useState(false),
    [projectText, setProjectText] = useState('');
  const controller = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    generation = useRef(0);
  const agentData = useMemo(
    () => summarizeAgentData(table, mapping),
    [table, mapping],
  );
  const checked = useMemo(() => validate(table, mapping), [table, mapping]);
  const data = checked.data;
  const python = usePythonWorkspace(table, data, config);
  const thin = useMemo(
    () => (posterior ? ThinPosterior(posterior) : null),
    [posterior],
  );
  const effectiveMultipliers = mapping.channels.map(
      (_, i) => multipliers[i] ?? 1,
    ),
    deferred = useDeferredValue(effectiveMultipliers.join(','));
  const simulation = useMemo(
    () =>
      data && thin
        ? scenario(data, thin, config.lag, deferred.split(',').map(Number))
        : null,
    [data, thin, config.lag, deferred],
  );
  const spend = data
    ? data.channels.map(
        (_, j) => data.x.reduce((s, r) => s + r[j], 0) / data.x.length,
      )
    : [];
  const totalSpend = spend.reduce((s, n) => s + n, 0);
  const good = posterior ? healthy(posterior) : false;
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('mixlab-workspace-v1');
      if (raw) {
        const saved = readProject(raw);
        saved.dataset.example =
          JSON.stringify(saved.dataset.rows) === JSON.stringify(example.rows);
        setTable(saved.dataset);
        setMapping(saved.mapping);
        setConfig(saved.config);
        setPosterior(saved.posterior);
        setMultipliers(saved.scenarioMultipliers);
        setNotice('Your last local session was restored.');
      }
    } catch {
      setNotice(
        'The previous local session could not be restored. Import an exported project to recover it.',
      );
    } finally {
      setHydrated(true);
    }
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    if (!data) {
      setSaveStatus('invalid');
      return;
    }
    setSaveStatus('saving');
    const save = () => {
      try {
        sessionStorage.setItem('mixlab-workspace-v1', projectJSON());
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unavailable');
      }
    };
    const timer = setTimeout(save, 500);
    window.addEventListener('pagehide', save);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', save);
    };
  }, [hydrated, table, mapping, config, posterior, multipliers, data]);
  function restoreProjectText(text: string) {
    const project = readProject(text);
    invalidate();
    setTable(project.dataset);
    setMapping(project.mapping);
    setConfig(project.config);
    setPosterior(project.posterior);
    setMultipliers(project.scenarioMultipliers);
    setTab('overview');
    setNotice(
      'Project restored locally. Saved posterior and scenarios are available; original Arrow files remain separate exports.',
    );
  }
  function pasteProject() {
    try {
      restoreProjectText(projectText);
      setPasteOpen(false);
      setProjectText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function invalidate() {
    generation.current++;
    controller.current?.abort();
    setPosterior(null);
    setTraces([]);
    setMultipliers([]);
    setProgress(emptyProgress);
    setError('');
    setNotice('');
  }
  function changeConfig<K extends keyof Config>(key: K, value: Config[K]) {
    invalidate();
    setConfig((c) => ({ ...c, [key]: value }));
  }
  function changeMapping(m: Mapping) {
    invalidate();
    setMapping(m);
  }
  async function upload(file: File | undefined) {
    if (!file || busy) return;
    try {
      if (file.size > 5_000_000) throw Error('Choose a CSV smaller than 5 MB.');
      const raw = parseCSV(await file.text(), file.name.replace(/\.csv$/i, ''));
      invalidate();
      setTable(raw);
      setMapping(inferMapping(raw));
      setTab('data');
      setNotice('CSV loaded locally. Review the column roles before fitting.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  function loadExample() {
    invalidate();
    setTable(example);
    setMapping(inferMapping(example));
    setConfig(defaultConfig);
    setNotice('Synthetic example loaded.');
  }
  async function run() {
    if (!data || busy || python.busy)
      return {
        status: 'unavailable',
        message: 'Validate data and wait for the current fit first.',
      };
    const epoch = ++generation.current;
    setBusy(true);
    setPosterior(null);
    setTraces([]);
    setError('');
    setNotice('');
    setProgress(emptyProgress);
    setTab('overview');
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const result = await fit(
        data,
        config,
        (p) => {
          if (epoch === generation.current) setProgress(p);
        },
        ctrl.signal,
      );
      if (epoch !== generation.current) return { status: 'cancelled' };
      setSavedFits((previous) => [
        ...previous.slice(-3),
        {
          id: ++fitId.current,
          dataset: JSON.stringify({ table, mapping }),
          config: structuredClone(config),
          posterior: result.posterior,
        },
      ]);
      setPosterior(result.posterior);
      setTraces(result.traces);
      setNotice(
        'Local fit complete. Review convergence before interpreting contributions.',
      );
      return {
        status: 'complete',
        diagnostics: result.posterior.diagnostics,
        contributions: result.posterior.contributions,
      };
    } catch (e) {
      if (ctrl.signal.aborted)
        setNotice('Run stopped. No partial result was saved.');
      else setError(e instanceof Error ? e.message : String(e));
      return {
        status: ctrl.signal.aborted ? 'cancelled' : 'failed',
        message: e instanceof Error ? e.message : String(e),
      };
    } finally {
      setBusy(false);
      controller.current = null;
    }
  }
  function projectJSON() {
    return JSON.stringify(
      {
        format: 'mixlab-project',
        version: 1,
        createdAt: new Date().toISOString(),
        dataset: table,
        mapping,
        config,
        posterior,
        scenarioMultipliers: effectiveMultipliers,
      },
      null,
      2,
    );
  }
  async function copyProject() {
    try {
      await navigator.clipboard.writeText(projectJSON());
      setNotice(
        'Project JSON copied. Paste it into a .json file to keep your data and fit.',
      );
    } catch {
      setError(
        'Clipboard access is unavailable in this browser. Try the project download.',
      );
    }
  }
  function exportProject() {
    download('mixlab-project.json', projectJSON());
    setNotice(
      'Project export prepared. If your browser blocks the download, use Copy project JSON.',
    );
  }
  function exportPython() {
    download('mixlab-model.py', pythonScript(config), 'text/x-python');
    setNotice(
      'Python model downloaded. Download the model CSV as well, or use the self-contained notebook.',
    );
  }
  function exportNotebook(mode: 'native' | 'browser') {
    if (!data) return;
    download(
      `mixlab-${mode}.ipynb`,
      JSON.stringify(notebook(data, config, mode, location.origin), null, 2),
      'application/x-ipynb+json',
    );
    setNotice(
      `${mode === 'native' ? 'Native PyMC' : 'Browser'} notebook downloaded with your data and editable model code.`,
    );
  }
  function openLab() {
    if (!data) return;
    try {
      const key = `mixlab-lab-${crypto.randomUUID()}`;
      sessionStorage.setItem(key, JSON.stringify(labPayload(data, config)));
      window.open(`/notebook.html#local=${encodeURIComponent(key)}`, '_blank');
      setNotice('Python lab opened with a separate, editable model session.');
    } catch {
      setError(
        'Could not open the local lab. Export the browser notebook instead.',
      );
    }
  }
  async function importProject(file: File | undefined) {
    if (!file || busy) return;
    try {
      if (file.size > 20_000_000)
        throw Error('Choose a project smaller than 20 MB.');
      restoreProjectText(await file.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (projectInput.current) projectInput.current.value = '';
    }
  }

  const datasetIdentity = JSON.stringify({ table, mapping });
  const comparableFits = savedFits.filter((f) => f.dataset === datasetIdentity);
  const agentRevision = JSON.stringify({
    datasetIdentity,
    view: tab,
    config,
    multipliers: effectiveMultipliers,
    fitted: !!posterior,
    python: python.draft,
    pythonStatus: python.status,
  });
  const agentContext = {
    python: {
      draft: python.draft,
      busy: python.busy,
      status: python.status.startsWith('Complete')
        ? 'complete'
        : 'not complete',
      kernelMatchesDraft: python.fresh,
      originalColumns: table.headers,
    },
    view: tab,
    dataset: { weeks: table.rows.length, synthetic: table.example, mapping },
    validation: { errors: checked.errors, warnings: checked.warnings },
    config,
    fitting: busy,
    diagnostics: posterior?.diagnostics ?? null,
    contributions: posterior?.contributions ?? null,
    scenario: simulation,
    scenarioMultipliers: effectiveMultipliers,
    fits: comparableFits.map((f) => ({
      id: f.id,
      config: f.config,
      diagnostics: f.posterior.diagnostics,
      contributions: f.posterior.contributions,
    })),
  };
  async function agentAction(input: AgentAction): Promise<unknown> {
    const action = validateAction(input);
    if (action.kind === 'navigate') {
      focusWorkspace(action.view);
      return `Opened ${action.view}.`;
    }
    if (busy || python.busy)
      throw Error('A fit or Python cell is running. Wait for it to finish.');
    if (action.kind === 'python_draft') {
      python.setDraft({
        source: action.source,
        varNames: action.varNames,
        analysis: action.analysis,
      });
      focusWorkspace('code');
      return 'Custom Python draft updated; not executed. Review in Code.';
    }
    if (action.kind === 'python_fit') {
      focusWorkspace('code');
      return await python.run();
    }
    if (action.kind === 'python_cell') {
      focusWorkspace('code');
      return await python.run(action.source);
    }
    if (action.kind === 'python_output') return { output: python.output };

    if (action.kind === 'configure') {
      invalidate();
      setConfig((c) => ({ ...c, ...action.patch }));
      focusWorkspace('model');
      return 'Model draft updated. Previous completed fits remain in the comparison strip; fit this draft to compute new results.';
    }
    if (action.kind === 'fit') {
      focusWorkspace('overview');
      return await run();
    }
    if (!data || !posterior)
      throw Error('Fit the current model before evaluating a scenario.');
    if (action.channel >= data.channels.length)
      throw Error('Channel is not in this dataset.');
    const next = [...effectiveMultipliers];
    next[action.channel] = action.multiplier;
    setMultipliers(next);
    focusWorkspace('scenarios');
    return scenario(data, ThinPosterior(posterior), config.lag, next);
  }

  const runAction = (
    <Button
      className="run-button"
      disabled={!data || busy || python.busy}
      onClick={run}
    >
      <Play size={16} />
      {posterior ? 'Run again' : 'Fit in this browser'}
      <ArrowRight />
    </Button>
  );
  return (
    <main className={`studio ${agentOpen ? 'with-agent' : ''}`}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Mixlab home">
          <span className="brand-icon">
            <Layers3 size={22} />
          </span>
          mixlab<span className="alpha">LAB / 01</span>
        </a>
        <div className="privacy">
          <span className="status-dot" /> Computed on your device{' '}
          <LockKeyhole size={14} />
        </div>
        <div className="header-open">
          <Button variant="outline" onClick={() => setAgentOpen((v) => !v)}>
            <Sparkles size={16} />
            {agentOpen ? 'Hide assistant' : 'Investigate together'}
          </Button>
          <a
            className="source-link"
            href={SOURCE_URL}
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={15} /> View source <ArrowUpRight size={14} />
          </a>
          <button
            className="about-button"
            aria-label="About Mixlab"
            onClick={() => setAboutOpen(true)}
          >
            <CircleHelp size={17} />
          </button>
        </div>
      </header>
      <div hidden={!agentOpen}>
        <Investigation
          context={agentContext}
          dataSummary={agentData}
          revision={agentRevision}
          busy={busy || python.busy}
          onAction={agentAction}
          onClose={() => setAgentOpen(false)}
        />
      </div>
      <section className="workspace">
        <div className="workspace-heading">
          <div>
            <div className="eyebrow">
              YOUR INVESTIGATION <span>/</span>{' '}
              {table.example ? 'EXPERIMENT 001' : 'YOUR DATASET'}
            </div>
            <h1>
              What drives your mix<span>?</span>
            </h1>
            <p>
              Agent-guided modeling. Full access to the assumptions and Python.
            </p>
          </div>
          <div className="heading-actions">
            <Button
              variant="outline"
              className="action"
              onClick={() => setTab('data')}
            >
              <Database /> Your data <ArrowUpRight />
            </Button>
            <Button
              variant="outline"
              className="action"
              onClick={() => setExportOpen(true)}
            >
              <Download /> Export
            </Button>
          </div>
        </div>
        {comparableFits.length > 0 && (
          <section
            className="fit-history"
            aria-label="Completed fit comparisons"
          >
            <div>
              <strong>Evidence from this session</strong>
              <p>
                Completed fits stay separate from your current draft. Keep up to
                four; export a project for a durable backup.
              </p>
            </div>
            <div className="fit-cards">
              {comparableFits.map((f) => (
                <article key={f.id}>
                  <strong>
                    Fit {f.id}
                    {posterior === f.posterior ? ' · current' : ''}
                  </strong>
                  <p>
                    {f.config.lag}-week carryover · prior scale{' '}
                    {f.config.priorScale} · seasonality{' '}
                    {f.config.seasonality ? 'on' : 'off'}
                  </p>
                  <p>
                    R-hat{' '}
                    {f.posterior.diagnostics.maxRhat?.toFixed(3) ??
                      'unavailable'}{' '}
                    · {f.posterior.diagnostics.divergences} divergences
                  </p>
                  {mapping.channels.map((channel, i) => (
                    <p key={channel}>
                      {label(channel)}:{' '}
                      {compact(f.posterior.contributions[i].median)}{' '}
                      <span>
                        ({compact(f.posterior.contributions[i].low)}–
                        {compact(f.posterior.contributions[i].high)})
                      </span>
                    </p>
                  ))}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      invalidate();
                      setConfig(f.config);
                      setPosterior(f.posterior);
                      setTab('overview');
                    }}
                  >
                    Open this fit
                  </Button>
                </article>
              ))}
            </div>
          </section>
        )}
        {error && (
          <div role="alert" className="notice error">
            <TriangleAlert />
            <span>{error}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <X />
            </Button>
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            <Check />
            <span>{notice}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss notification"
              onClick={() => setNotice('')}
            >
              <X />
            </Button>
          </div>
        )}
        <div
          id="workbench-focus"
          className="workbench-focus"
          data-focused={!!focusNote && focusNote === tab}
        >
          {focusNote && focusNote === tab && (
            <div key={focusTick} className="focus-note" role="status">
              <Sparkles size={15} /> Working in{' '}
              {focusNote === 'overview' ? 'results & diagnostics' : focusNote}
              <button
                aria-label="Dismiss workspace highlight"
                onClick={() => setFocusNote('')}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
            <div className="tabbar">
              <TabsList variant="line">
                <TabsTrigger value="overview">
                  <Activity /> Overview
                </TabsTrigger>
                <TabsTrigger value="data">
                  <Database /> Data
                </TabsTrigger>
                <TabsTrigger value="model">
                  <SlidersHorizontal /> Model
                </TabsTrigger>
                <TabsTrigger value="scenarios">
                  <Sparkles /> Scenarios
                </TabsTrigger>
                <TabsTrigger value="code">
                  <Code2 /> Code
                </TabsTrigger>
              </TabsList>
              <span className="dataset-tag">
                <span />
                {table.example ? 'Synthetic example' : table.name} ·{' '}
                {table.rows.length} weeks
              </span>
            </div>
            <TabsContent value="overview">
              <div className="metrics">
                <div>
                  <span>
                    Total observed {label(mapping.target).toLowerCase()}
                  </span>
                  <strong>
                    {data ? compact(data.y.reduce((a, b) => a + b, 0)) : '—'}
                  </strong>
                  <p>
                    {data
                      ? `${data.dates[0]} → ${data.dates.at(-1)}`
                      : 'Review your data mapping to continue'}
                  </p>
                </div>
                <div>
                  <span>Average weekly spend</span>
                  <strong>
                    {data ? compact(totalSpend) : '—'}
                    <small> / week</small>
                  </strong>
                  <p>
                    {mapping.channels.length} channels · Original data units
                  </p>
                </div>
                <div>
                  <span>Model status</span>
                  <strong className="status-value">
                    {busy
                      ? 'Learning your mix'
                      : posterior
                        ? good
                          ? 'Fit complete'
                          : 'Review convergence'
                        : 'Ready to explore'}
                    {busy ? (
                      <LoaderCircle className="spin" />
                    ) : posterior && !good ? (
                      <TriangleAlert size={21} />
                    ) : (
                      <ArrowUpRight />
                    )}
                  </strong>
                  <p>
                    {busy
                      ? progress.phase
                      : posterior
                        ? `${number(posterior.diagnostics.samplingSeconds, 1)}s sampling · ${config.chains} chains`
                        : 'Fit your first model to reveal the posterior'}
                  </p>
                </div>
              </div>
              <div className="main-grid">
                <section className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <div className="eyebrow">THE BIG PICTURE</div>
                      <h2>{label(mapping.target)} over time</h2>
                    </div>
                    <div className="chart-tools">
                      <span className="legend">
                        <i /> Observed
                      </span>
                      {posterior && (
                        <span className="legend purple">
                          <i /> Model
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setLastYear((v) => !v)}
                      >
                        {lastYear ? 'Last 52 weeks' : 'All weeks'}{' '}
                        <RotateCcw size={13} />
                      </Button>
                    </div>
                  </div>
                  {data ? (
                    <RevenueChart
                      data={data}
                      posterior={posterior}
                      lastYear={lastYear}
                    />
                  ) : (
                    <div className="empty-inline">
                      <TriangleAlert />
                      <p>Resolve the data checks to see your time series.</p>
                      <Button onClick={() => setTab('data')}>
                        Review data <ArrowRight />
                      </Button>
                    </div>
                  )}
                  <div className="chart-footer">
                    <span>
                      <span className="status-dot" /> {table.rows.length} weekly
                      observations
                    </span>
                    <span>
                      {posterior
                        ? 'Posterior prediction · 90% interval'
                        : 'Fit a model to add the prediction interval'}
                    </span>
                  </div>
                </section>
                <section className="panel run-panel">
                  <span className="orbital">
                    {busy ? (
                      <LoaderCircle className="spin" size={26} />
                    ) : (
                      <FlaskConical size={27} />
                    )}
                  </span>
                  <div className="eyebrow">
                    {busy
                      ? 'BAYESIAN INFERENCE, LIVE'
                      : 'FROM DATA TO EVIDENCE'}
                  </div>
                  <h2>
                    {busy ? (
                      'Finding the signal.'
                    ) : posterior ? (
                      'Follow the evidence.'
                    ) : (
                      <>
                        Your next
                        <br />
                        good question.
                      </>
                    )}
                  </h2>
                  {busy ? (
                    <>
                      <p aria-live="polite">{progress.phase}</p>
                      <div className="live-progress">
                        <Progress
                          aria-label="Overall sampling progress"
                          value={progress.percent}
                        />
                        <div>
                          <span>
                            {progress.percent === null
                              ? 'Preparing…'
                              : `${Math.round(progress.percent)}%`}
                          </span>
                          <span>
                            {progress.chain
                              ? `Chain ${progress.chain} / ${config.chains}`
                              : 'First load may take a minute'}
                          </span>
                        </div>
                      </div>
                      {progress.alpha.length > 0 ? (
                        <>
                          <Histogram values={progress.alpha} />
                          <p className="tiny">
                            Live carryover posterior ·{' '}
                            {label(mapping.channels[0])}
                            <br />
                            {number(progress.retained)} retained draws
                          </p>
                        </>
                      ) : (
                        <p className="tiny">
                          The browser downloads ~120 MB on first use, then
                          compiles your model. You can keep exploring.
                        </p>
                      )}
                      <Button
                        className="stop-button"
                        variant="outline"
                        onClick={() => controller.current?.abort()}
                      >
                        <X /> Stop run
                      </Button>
                    </>
                  ) : (
                    <>
                      <p>
                        {posterior
                          ? 'Compare channel contributions and test a different mix — with uncertainty attached.'
                          : 'How much does each channel contribute — and how sure are we?'}
                      </p>
                      <div className="run-facts">
                        <span>
                          Carryover window <span>{config.lag} weeks</span>
                        </span>
                        <span>
                          Posterior draws{' '}
                          <span>
                            {number(config.chains * config.draws)} ·{' '}
                            {config.chains} chains
                          </span>
                        </span>
                        <span>
                          Where it runs <span>This browser</span>
                        </span>
                      </div>
                      {posterior ? (
                        <Button
                          className="run-button"
                          onClick={() => setTab('scenarios')}
                        >
                          <Sparkles /> Explore scenarios <ArrowRight />
                        </Button>
                      ) : (
                        runAction
                      )}
                      <Button
                        className="text-button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setTab('model')}
                      >
                        <SlidersHorizontal /> Adjust model assumptions
                      </Button>
                      {!posterior && (
                        <small>Runtime downloads once · ~120 MB</small>
                      )}
                    </>
                  )}
                </section>
              </div>
              {posterior && (
                <section
                  className={`panel diagnostics ${good ? '' : 'needs-review'}`}
                >
                  <div>
                    <span className="diagnostic-icon">
                      {good ? <CheckCheck /> : <TriangleAlert />}
                    </span>
                    <div>
                      <h3>
                        {good
                          ? 'Convergence checks passed'
                          : 'Inspect before interpreting'}
                      </h3>
                      <p>
                        {good
                          ? 'These checks support numerical reliability; they do not establish causal identification.'
                          : 'Try more warmup/draws or stronger priors. Diagnostics are not yet sufficient for reliable interpretation.'}
                      </p>
                    </div>
                  </div>
                  <div className="diagnostic-values">
                    <span>
                      Max R̂{' '}
                      <strong>
                        {posterior.diagnostics.maxRhat?.toFixed(4) ??
                          'Unavailable'}
                      </strong>
                      <small>≤ 1.01</small>
                    </span>
                    <span>
                      Min bulk ESS{' '}
                      <strong>
                        {posterior.diagnostics.minEss === null
                          ? 'Unavailable'
                          : number(posterior.diagnostics.minEss)}
                      </strong>
                      <small>≥ 400</small>
                    </span>
                    <span>
                      Min tail ESS{' '}
                      <strong>
                        {posterior.diagnostics.minTailEss === null
                          ? 'Unavailable'
                          : number(posterior.diagnostics.minTailEss)}
                      </strong>
                      <small>≥ 400</small>
                    </span>
                    <span>
                      Divergences{' '}
                      <strong>{posterior.diagnostics.divergences}</strong>
                      <small>0 expected</small>
                    </span>
                  </div>
                </section>
              )}
              <div className="section-label">
                <h2>
                  {posterior ? 'Your channel signals' : 'The ingredients'}
                </h2>
                <span>
                  {posterior
                    ? 'AVERAGE WEEKLY CONTRIBUTION · 90% CREDIBLE INTERVAL'
                    : 'CHANNEL INPUTS'}
                </span>
              </div>
              <div
                className={`channel-grid ${posterior ? 'fitted-channels' : ''}`}
              >
                {mapping.channels.map((name, i) => (
                  <section className="panel channel-card" key={name}>
                    <div className="channel-top">
                      <div
                        className="channel-icon"
                        style={{ color: colors[i] }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <h3>{label(name)}</h3>
                        <p>
                          {data
                            ? `${compact(spend[i])} average weekly spend`
                            : 'Review data mapping'}
                        </p>
                      </div>
                      <ArrowUpRight size={19} />
                    </div>
                    {posterior && (
                      <>
                        <div className="channel-result">
                          <strong style={{ color: colors[i] }}>
                            {compact(posterior.contributions[i].median)}
                          </strong>
                          <span>
                            {compact(posterior.contributions[i].low)} –{' '}
                            {compact(posterior.contributions[i].high)}
                          </span>
                        </div>
                        <ResponseCurve
                          color={colors[i]}
                          scale={posterior.channelScale[i]}
                          posterior={thin}
                          channel={i}
                        />
                        <p className="tiny curve-caption">
                          Adstock-adjusted spend → response · 90% interval
                        </p>
                      </>
                    )}
                  </section>
                ))}
                <button
                  className="panel data-cta"
                  onClick={() => setTab('data')}
                >
                  <Database />
                  <span>
                    Bring your own data
                    <small>Your CSV stays on this device</small>
                  </span>
                  <ArrowRight />
                </button>
              </div>
            </TabsContent>
            <TabsContent value="data">
              <div className="section-intro">
                <div className="eyebrow">LOCAL BY DESIGN</div>
                <h2>Start with your own evidence.</h2>
                <p>
                  Weekly observations. One outcome. The channels and controls
                  that matter.
                </p>
              </div>
              <div className="data-layout">
                <div>
                  <section
                    className="panel upload-panel"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void upload(e.dataTransfer.files[0]);
                    }}
                  >
                    <Upload size={25} />
                    <div>
                      <h3>Drop your CSV here</h3>
                      <p>
                        52–520 weekly rows · Up to 8 channels · 5 MB maximum
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => fileInput.current?.click()}
                    >
                      Choose file <ArrowUpRight />
                    </Button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".csv,text/csv"
                      className="sr-only"
                      aria-label="Choose CSV dataset"
                      disabled={busy}
                      onChange={(e) => void upload(e.target.files?.[0])}
                    />
                  </section>
                  <section className="panel mapping-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Give each column a role</h2>
                        <p>
                          Dates use YYYY-MM-DD. Numeric columns use plain
                          numbers.
                        </p>
                      </div>
                    </div>
                    <div className="mapping-primary">
                      <div>
                        <label htmlFor="date-column">Week</label>
                        <Picker
                          id="date-column"
                          value={mapping.date}
                          options={table.headers}
                          disabled={busy}
                          onChange={(v) =>
                            changeMapping({
                              ...mapping,
                              date: v,
                              channels: mapping.channels.filter((c) => c !== v),
                              controls: mapping.controls.filter((c) => c !== v),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label htmlFor="target-column">Outcome</label>
                        <Picker
                          id="target-column"
                          value={mapping.target}
                          options={table.headers.filter(
                            (h) => h !== mapping.date,
                          )}
                          disabled={busy}
                          onChange={(v) =>
                            changeMapping({
                              ...mapping,
                              target: v,
                              channels: mapping.channels.filter((c) => c !== v),
                              controls: mapping.controls.filter((c) => c !== v),
                            })
                          }
                        />
                      </div>
                    </div>
                    <div className="role-grid">
                      <div>
                        <h3>Marketing spend</h3>
                        <p>Select the channels to model.</p>
                        {table.headers
                          .filter(
                            (h) => h !== mapping.date && h !== mapping.target,
                          )
                          .map((h) => (
                            <label className="check-row" key={h}>
                              <Checkbox
                                checked={mapping.channels.includes(h)}
                                disabled={busy}
                                onCheckedChange={(v) =>
                                  changeMapping({
                                    ...mapping,
                                    channels: v
                                      ? [...mapping.channels, h]
                                      : mapping.channels.filter((c) => c !== h),
                                    controls: mapping.controls.filter(
                                      (c) => c !== h,
                                    ),
                                  })
                                }
                              />
                              {label(h)}
                            </label>
                          ))}
                      </div>
                      <div>
                        <h3>Control variables</h3>
                        <p>Promotions, trend, prices, or other drivers.</p>
                        {table.headers
                          .filter(
                            (h) => h !== mapping.date && h !== mapping.target,
                          )
                          .map((h) => (
                            <label className="check-row" key={h}>
                              <Checkbox
                                checked={mapping.controls.includes(h)}
                                disabled={busy}
                                onCheckedChange={(v) =>
                                  changeMapping({
                                    ...mapping,
                                    controls: v
                                      ? [...mapping.controls, h]
                                      : mapping.controls.filter((c) => c !== h),
                                    channels: mapping.channels.filter(
                                      (c) => c !== h,
                                    ),
                                  })
                                }
                              />
                              {label(h)}
                            </label>
                          ))}
                      </div>
                    </div>
                  </section>
                </div>
                <aside className="panel validation-panel">
                  <div className="eyebrow">DATA CHECK</div>
                  <h2>
                    {data ? 'Ready for the workbench.' : 'A few things to fix.'}
                  </h2>
                  <div className="validation-list">
                    {checked.errors.map((s, i) => (
                      <p className="validation-error" key={i}>
                        <TriangleAlert />
                        {s}
                      </p>
                    ))}
                    {data && (
                      <>
                        <p>
                          <Check /> {table.rows.length} complete weekly
                          observations
                        </p>
                        <p>
                          <Check /> Numeric, nonnegative spend and outcome
                        </p>
                        <p>
                          <Check /> No date gaps or duplicate weeks
                        </p>
                      </>
                    )}
                    {checked.warnings.map((s, i) => (
                      <p className="validation-warning" key={i}>
                        <TriangleAlert />
                        {s}
                      </p>
                    ))}
                  </div>
                  <Button
                    className="run-button"
                    disabled={!data || busy}
                    onClick={() => setTab('model')}
                  >
                    Set up your model <ArrowRight />
                  </Button>
                  <div className="data-links">
                    <button disabled={busy} onClick={() => setPasteOpen(true)}>
                      Paste project JSON <Code2 size={14} />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => projectInput.current?.click()}
                    >
                      Restore a Mixlab project <FileJson size={14} />
                    </button>
                    <input
                      ref={projectInput}
                      type="file"
                      className="sr-only"
                      accept=".json,application/json"
                      aria-label="Restore project JSON"
                      disabled={busy}
                      onChange={(e) => void importProject(e.target.files?.[0])}
                    />
                    <a href="/example.csv" download>
                      Download example CSV <Download size={14} />
                    </a>
                    <button disabled={busy} onClick={loadExample}>
                      Reset to synthetic example <RotateCcw size={14} />
                    </button>
                  </div>
                </aside>
              </div>
              <section className="panel data-table">
                <div className="panel-heading">
                  <h2>{table.name}</h2>
                  <span className="tiny">
                    First 8 of {table.rows.length} rows · Loaded in memory
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {table.headers.map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {table.rows.slice(0, 8).map((r, i) => (
                      <TableRow key={i}>
                        {table.headers.map((h) => (
                          <TableCell key={h}>{r[h]}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </TabsContent>
            <TabsContent value="model">
              <div className="section-intro">
                <div className="eyebrow">MODEL WORKBENCH</div>
                <h2>Make the assumptions yours.</h2>
                <p>
                  Every assumption is explicit. Changing one clears the previous
                  fit.
                </p>
              </div>
              <PriorEditor
                data={data}
                config={config}
                disabled={busy}
                onApply={(adstockPrior, saturationPrior, priorScale) => {
                  invalidate();
                  setConfig((c) => ({
                    ...c,
                    adstockPrior,
                    saturationPrior,
                    priorScale,
                  }));
                  setNotice(
                    'Priors applied. Python and notebook exports now use these distributions. Refit to update results.',
                  );
                }}
              />
              <div className="model-layout">
                <section className="panel model-controls">
                  <div className="model-step">
                    <span>01</span>
                    <div>
                      <h3>Memory & diminishing returns</h3>
                      <p>
                        Geometric carryover, followed by logistic saturation.
                      </p>
                    </div>
                  </div>
                  <Range
                    name="Carryover window"
                    value={config.lag}
                    min={2}
                    max={16}
                    suffix=" weeks"
                    onChange={(v) => changeConfig('lag', v)}
                    disabled={busy}
                  />
                  <Range
                    name="Channel effect prior scale"
                    value={config.priorScale}
                    min={0.25}
                    max={4}
                    step={0.25}
                    onChange={(v) => changeConfig('priorScale', v)}
                    disabled={busy}
                  />
                  <p className="tiny">
                    β ~ HalfNormal(σ); α ~ Beta(
                    {config.adstockPrior?.alpha ?? 1},{' '}
                    {config.adstockPrior?.beta ?? 3}); λ ~ Gamma(
                    {config.saturationPrior?.alpha ?? 3},{' '}
                    {config.saturationPrior?.beta ?? 1}). Channel and outcome
                    scales are inferred from the data.
                  </p>
                  <div className="toggle-row">
                    <div>
                      <label htmlFor="seasonality">Yearly seasonality</label>
                      <p>Two Fourier harmonics</p>
                    </div>
                    <Switch
                      id="seasonality"
                      checked={config.seasonality}
                      onCheckedChange={(v) => changeConfig('seasonality', v)}
                      disabled={busy}
                    />
                  </div>
                  <div className="model-step second">
                    <span>02</span>
                    <div>
                      <h3>Sampling budget</h3>
                      <p>More draws improve precision when chains mix well.</p>
                    </div>
                  </div>
                  <div className="two-fields">
                    <div>
                      <label htmlFor="chains">Chains</label>
                      <Picker
                        id="chains"
                        value={String(config.chains)}
                        options={['2', '4']}
                        disabled={busy}
                        onChange={(v) => changeConfig('chains', Number(v))}
                      />
                    </div>
                    <div>
                      <label htmlFor="draws">Draws per chain</label>
                      <Picker
                        id="draws"
                        value={String(config.draws)}
                        options={['500', '1000', '1500']}
                        disabled={busy}
                        onChange={(v) => changeConfig('draws', Number(v))}
                      />
                    </div>
                    <div>
                      <label htmlFor="tune">Warmup per chain</label>
                      <Picker
                        id="tune"
                        value={String(config.tune)}
                        options={['750', '1000', '1500']}
                        disabled={busy}
                        onChange={(v) => changeConfig('tune', Number(v))}
                      />
                    </div>
                    <div>
                      <label htmlFor="accept">Target acceptance</label>
                      <Picker
                        id="accept"
                        value={String(config.targetAccept)}
                        options={['0.9', '0.95', '0.99']}
                        disabled={busy}
                        onChange={(v) =>
                          changeConfig('targetAccept', Number(v))
                        }
                      />
                    </div>
                  </div>
                  <label className="seed-label" htmlFor="seed">
                    Random seed
                  </label>
                  <Input
                    id="seed"
                    className="seed-input"
                    type="number"
                    min={0}
                    max={2147483000}
                    value={config.seed}
                    disabled={busy}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 0 && n <= 2147483000)
                        changeConfig('seed', n);
                    }}
                  />
                </section>
                <div>
                  <section className="panel assumption-panel">
                    <div className="eyebrow">YOUR MODEL, AT A GLANCE</div>
                    <h2>
                      A little memory.
                      <br />A limit to growth.
                    </h2>
                    <div className="model-flow">
                      <span>Spend</span>
                      <ArrowRight />
                      <span>Adstock</span>
                      <ArrowRight />
                      <span>Saturation</span>
                    </div>
                    <ResponseCurve
                      color="#b5f268"
                      scale={1}
                      priorScale={config.priorScale}
                    />
                    <p className="tiny">
                      Illustrative shape at λ = 3, β = {config.priorScale}.
                      Horizontal axis: scaled adstock. This is a shape
                      illustration, not a prior predictive check.
                    </p>
                    <div className="model-equation">
                      outcome = baseline + channels
                      <br />
                      {config.seasonality ? '+ seasonality ' : ''}
                      {mapping.controls.length ? '+ controls ' : ''}+ noise
                    </div>
                    <div className="model-summary">
                      <span>{mapping.channels.length} channels</span>
                      <span>{mapping.controls.length} controls</span>
                      <span>{config.lag}-week carryover</span>
                    </div>
                  </section>
                  <section className="panel ready-panel">
                    <h3>Ready to ask the data?</h3>
                    <p>
                      {number(config.chains * (config.draws + config.tune))}{' '}
                      total iterations, running locally. Keep this tab open
                      while fitting.
                    </p>
                    {runAction}
                    {!data && (
                      <p className="validation-warning">
                        Resolve the data checks before fitting.
                      </p>
                    )}
                    <Button
                      variant="ghost"
                      className="text-button"
                      onClick={() => setExportOpen(true)}
                    >
                      <Code2 /> Export the actual Python model
                    </Button>
                  </section>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="scenarios">
              <div className="section-intro">
                <div className="eyebrow">THE WHAT-IF LAB</div>
                <h2>A different mix. A range of possibilities.</h2>
                <p>
                  Replay the observed period with different channel budgets.
                  Keep everything else fixed.
                </p>
              </div>
              {!posterior || !data ? (
                <section className="panel scenario-empty">
                  <Sparkles size={32} />
                  <h2>Your posterior is the starting point.</h2>
                  <p>
                    Fit a model to unlock budget sliders, channel response
                    curves, and uncertainty-aware comparisons.
                  </p>
                  <Button onClick={() => setTab('model')}>
                    Set up the model <ArrowRight />
                  </Button>
                </section>
              ) : (
                <>
                  {!good && (
                    <div className="notice warning">
                      <TriangleAlert />
                      <span>
                        The fit needs convergence review. These scenarios are
                        exploratory and should not guide budget decisions yet.
                      </span>
                    </div>
                  )}
                  <div className="scenario-layout">
                    <AllocationPlanner
                      data={data}
                      posterior={thin!}
                      lag={config.lag}
                      multipliers={effectiveMultipliers}
                      onChange={setMultipliers}
                    />
                    <section className="panel impact-panel">
                      <span className="orbital">
                        <Sparkles size={24} />
                      </span>
                      <div className="eyebrow">
                        EXPECTED CHANGE IN CHANNEL CONTRIBUTION
                      </div>
                      <h2>
                        {simulation
                          ? (simulation.delta.median >= 0 ? '+' : '') +
                            compact(simulation.delta.median)
                          : '—'}
                        <small> / week</small>
                      </h2>
                      <p>
                        Change in average weekly modeled outcome, on the
                        original scale.
                      </p>
                      <div className="impact-interval">
                        <span>90% credible interval</span>
                        <strong>
                          {simulation
                            ? `${compact(simulation.delta.low)} to ${compact(simulation.delta.high)}`
                            : '—'}
                        </strong>
                      </div>
                      <div className="impact-probability">
                        <span>
                          {simulation
                            ? Math.round(simulation.probabilityPositive * 100)
                            : 0}
                          %
                        </span>
                        <p>
                          of evaluated posterior draws
                          <br />
                          show a positive change
                        </p>
                      </div>
                      <div className="planner-predictive">
                        <div className="eyebrow">
                          POSTERIOR PREDICTIVE · AVERAGE WEEK
                        </div>
                        {simulation?.predictive ? (
                          <>
                            <h3>{compact(simulation.predictive.median)}</h3>
                            <p>
                              90% predictive interval:{' '}
                              {compact(simulation.predictive.low)}–
                              {compact(simulation.predictive.high)}
                            </p>
                            <p>
                              Original mix:{' '}
                              {compact(simulation.predictiveBaseline!.median)} ·
                              Includes baseline, controls, seasonality and
                              observation noise, averaged over the replayed
                              period.
                            </p>
                          </>
                        ) : (
                          <p>
                            Refit this model to include predictive draws. Saved
                            older fits contain contribution uncertainty only.
                          </p>
                        )}
                      </div>
                      <div className="scenario-assumptions">
                        <LockKeyhole size={15} />
                        <p>
                          Same dates, baseline, controls, and seasonality.
                          Carryover is recomputed for the changed spend. This is
                          a historical counterfactual, not a forecast.
                        </p>
                      </div>
                    </section>
                  </div>
                  <section className="panel scenario-table">
                    <div className="panel-heading">
                      <h2>Where the change comes from</h2>
                      <span className="tiny">
                        {thin?.alpha.length} evenly selected posterior draws ·
                        Approximate 90% intervals
                      </span>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Channel</TableHead>
                          <TableHead>Observed-mix contribution</TableHead>
                          <TableHead>Scenario contribution</TableHead>
                          <TableHead>Scenario 90% interval</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.channels.map((c, i) => (
                          <TableRow key={c}>
                            <TableCell>
                              <span
                                className="colored-dot"
                                style={{ background: colors[i] }}
                              />
                              {label(c)}
                            </TableCell>
                            <TableCell>
                              {compact(
                                simulation?.channels[i].baseline.median ?? 0,
                              )}
                            </TableCell>
                            <TableCell>
                              {compact(
                                simulation?.channels[i].changed.median ?? 0,
                              )}
                            </TableCell>
                            <TableCell>
                              {compact(
                                simulation?.channels[i].changed.low ?? 0,
                              )}{' '}
                              –{' '}
                              {compact(
                                simulation?.channels[i].changed.high ?? 0,
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="table-note">
                      Modeled contributions depend on priors, controls, and
                      identification assumptions. They do not independently
                      establish incremental causality.
                    </p>
                  </section>
                </>
              )}
            </TabsContent>
            <TabsContent value="code">
              <section className="panel custom-python">
                <div className="eyebrow">
                  EXPERIMENTAL / OPEN MODEL WORKSPACE
                </div>
                <h2>Build beyond the guided model.</h2>
                <p>
                  You and the assistant edit the same Python draft. Define a
                  PyMC <code>model</code>; the browser samples it. Original
                  columns are available in <code>/mixlab-raw.csv</code>.
                  Hierarchical and time-varying models depend on runtime
                  compatibility.
                </p>
                <Button
                  variant="outline"
                  disabled={!data || busy || python.busy}
                  onClick={() => {
                    try {
                      python.seed();
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Start from guided model
                </Button>
                <label htmlFor="custom-source">
                  Model source · shared with the connected assistant
                </label>
                <Textarea
                  id="custom-source"
                  spellCheck={false}
                  value={python.draft.source}
                  disabled={python.busy}
                  onChange={(e) =>
                    python.setDraft((d) => ({ ...d, source: e.target.value }))
                  }
                  placeholder="Ask the assistant to draft a model, or start from the guided model."
                />
                <label htmlFor="custom-variables">
                  Posterior variables · comma separated
                </label>
                <Input
                  id="custom-variables"
                  value={python.draft.varNames.join(', ')}
                  disabled={python.busy}
                  onChange={(e) =>
                    python.setDraft((d) => ({
                      ...d,
                      varNames: e.target.value.split(',').map((v) => v.trim()),
                    }))
                  }
                />
                <label htmlFor="custom-analysis">
                  After sampling · idata is available
                </label>
                <Textarea
                  id="custom-analysis"
                  spellCheck={false}
                  value={python.draft.analysis}
                  disabled={python.busy}
                  onChange={(e) =>
                    python.setDraft((d) => ({ ...d, analysis: e.target.value }))
                  }
                />
                <p>
                  Code has access to your dataset and the network. Review it
                  before running. Sampling uses the budget in Model. Output
                  stays local until you explicitly share it with the assistant.
                </p>
                <div className="heading-actions">
                  <Button
                    disabled={
                      busy ||
                      python.busy ||
                      !python.draft.source.trim() ||
                      !python.draft.varNames.length ||
                      python.draft.varNames.some((v) => !v.trim())
                    }
                    onClick={() =>
                      void python.run().catch((e) => setError(String(e)))
                    }
                  >
                    Run custom model
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || python.busy || !python.fresh}
                    onClick={() =>
                      void python
                        .run(python.draft.analysis)
                        .catch((e) => setError(String(e)))
                    }
                  >
                    Run analysis cell
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!python.busy}
                    onClick={python.stop}
                  >
                    Stop Python
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!python.draft.source}
                    onClick={() =>
                      download(
                        'mixlab-custom-model.py',
                        python.draft.source +
                          '\n\n# After sampling (idata required):\n' +
                          python.draft.analysis,
                        'text/x-python',
                      )
                    }
                  >
                    Download code
                  </Button>
                </div>
                <p role="status">
                  {python.status}
                  {python.fresh
                    ? ' · Kernel matches this draft.'
                    : ' · No matching fitted kernel.'}
                </p>
                <pre className="custom-output" aria-label="Local Python output">
                  {python.output || 'Actual Python output will appear here.'}
                </pre>
                <p>
                  Custom results stay in this workspace; the guided charts and
                  scenarios describe only the guided model. Code and kernels
                  last for this page session. Download your code before leaving.
                </p>
              </section>
              <div className="section-intro">
                <div className="eyebrow">OPEN ALL THE WAY DOWN</div>
                <h2>The interface is a starting point.</h2>
                <p>
                  This is your actual model. Read it, run it, fork it. Take it
                  somewhere we didn’t think of.
                </p>
              </div>
              <div className="code-layout">
                <section className="panel source-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>mixlab-model.py</h2>
                      <p>Updates with your model settings</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(modelSource(config))
                          .then(() => setNotice('Model code copied.'))
                          .catch(() =>
                            setError(
                              'Clipboard unavailable. Use Download Python instead.',
                            ),
                          );
                      }}
                    >
                      Copy code <Code2 />
                    </Button>
                  </div>
                  <pre
                    tabIndex={0}
                    aria-label="Actual generated PyMC-Marketing model source"
                  >
                    <code>{modelSource(config)}</code>
                  </pre>
                </section>
                <div className="code-escapes">
                  <section className="panel escape-primary">
                    <span className="orbital">
                      <FlaskConical size={25} />
                    </span>
                    <div className="eyebrow">
                      STAY IN THE BROWSER. GO DEEPER.
                    </div>
                    <h2>Open the Python lab.</h2>
                    <p>
                      Edit the model, run real Python, and continue with{' '}
                      <code>mmm</code> and <code>idata</code> in a live session.
                      Same engine, fewer guardrails.
                    </p>
                    <Button
                      className="run-button"
                      disabled={!data}
                      onClick={openLab}
                    >
                      Open live Python lab <ArrowUpRight />
                    </Button>
                  </section>
                  <section className="panel notebook-panel">
                    <div className="eyebrow">YOUR NEXT ENVIRONMENT</div>
                    <h3>A notebook, with everything.</h3>
                    <p>
                      Data, assumptions, code, diagnostics, and a place to keep
                      going.
                    </p>
                    <Button
                      variant="outline"
                      disabled={!data}
                      onClick={() => exportNotebook('native')}
                    >
                      <Download /> Native PyMC notebook
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!data}
                      onClick={() => exportNotebook('browser')}
                    >
                      <Download /> Browser notebook
                    </Button>
                    <a
                      href={NOTEBOOK_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="notebook-link"
                    >
                      Open notebook.link <ArrowUpRight size={16} />
                    </a>
                    <p className="tiny">
                      Launches the public example workspace. Import your
                      downloaded browser notebook there to use your own data;
                      the app does not upload it automatically.
                    </p>
                  </section>
                  <section className="panel fork-panel">
                    <Code2 />
                    <div>
                      <h3>Fork the whole thing.</h3>
                      <p>
                        MIT licensed. Bring your own models, extend the
                        interface, or self-host.
                      </p>
                      <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                        Browse the repository <ArrowUpRight size={14} />
                      </a>
                    </div>
                  </section>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
        <details className="local-privacy">
          <summary>Local computation · your own AI connection</summary>
          <p>
            CSV data and model fitting are handled in your browser. Mixlab does
            not receive your dataset or API key. When you connect AI, your
            browser sends your key directly to that provider, together with your
            messages, model code and summary context. Raw rows and posterior
            draws are excluded from automatic context. Python output is shared
            only after review; custom code can access the network.
          </p>
        </details>
        <footer>
          <span>
            <LockKeyhole size={14} /> Your data. Your device. Your model.
          </span>
          <span>
            PyMC-Marketing + nuts-rs <span className="footer-plus">+</span>{' '}
            {saveStatus === 'saved'
              ? 'Saved in this tab · Export to keep'
              : saveStatus === 'saving'
                ? 'Saving locally…'
                : saveStatus === 'invalid'
                  ? 'Review mapping to save locally'
                  : saveStatus === 'unavailable'
                    ? 'Local save unavailable · Export to keep'
                    : 'Opening local workspace…'}
          </span>
        </footer>
      </section>
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="export-dialog">
          <DialogTitle>Restore a copied project</DialogTitle>
          <DialogDescription>
            Paste a Mixlab project JSON. It is validated and restored entirely
            on your device.
          </DialogDescription>
          <Textarea
            aria-label="Project JSON"
            value={projectText}
            onChange={(e) => setProjectText(e.target.value)}
            placeholder="Paste your project JSON here…"
            style={{ minHeight: 240, fontFamily: 'monospace', fontSize: 12 }}
          />
          <Button disabled={!projectText.trim() || busy} onClick={pasteProject}>
            Restore project <ArrowRight />
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="export-dialog">
          <DialogTitle>Take your work with you.</DialogTitle>
          <DialogDescription>
            Export a reproducible project, the actual model, or chain-level
            samples. Nothing is uploaded.
          </DialogDescription>
          <div className="export-options">
            <Button
              variant="outline"
              disabled={!data}
              onClick={() => exportNotebook('native')}
            >
              <Code2 />
              <span>
                Native PyMC notebook
                <small>
                  Self-contained data + editable model + diagnostics
                </small>
              </span>
              <Download />
            </Button>
            <Button
              variant="outline"
              disabled={!data}
              onClick={() => exportNotebook('browser')}
            >
              <FlaskConical />
              <span>
                Browser notebook
                <small>
                  For notebook.link or Jupyter with our browser runtime
                </small>
              </span>
              <Download />
            </Button>
            <Button variant="outline" onClick={exportProject}>
              <FileJson />
              <span>
                Project JSON
                <small>Data, settings, posterior, and scenario</small>
              </span>
              <Download />
            </Button>
            <Button
              variant="outline"
              disabled={!data}
              onClick={() => void exportPython()}
            >
              <Code2 />
              <span>
                Python model<small>Plain Python, no Mixlab dependency</small>
              </span>
              <Download />
            </Button>
            <Button
              variant="outline"
              disabled={!data}
              onClick={() => {
                if (data)
                  download('mixlab-data.csv', canonicalCSV(data), 'text/csv');
              }}
            >
              <Database />
              <span>
                Model CSV
                <small>Canonical column names for the Python script</small>
              </span>
              <Download />
            </Button>
          </div>
          <Button variant="ghost" onClick={() => void copyProject()}>
            <FileJson /> Copy project JSON
          </Button>
          {traces.length > 0 && (
            <div className="trace-exports">
              <h3>Arrow traces · {traces.length} files</h3>
              {traces.map((t) => (
                <Button
                  key={`${t.chain}-${t.group}`}
                  variant="ghost"
                  onClick={() =>
                    download(
                      `chain-${t.chain + 1}-${t.group}.arrows`,
                      t.bytes,
                      'application/vnd.apache.arrow.stream',
                    )
                  }
                >
                  Chain {t.chain + 1} · {t.group} <Download size={14} />
                </Button>
              ))}
            </div>
          )}
          <p className="tiny">
            Files contain your data. Restore a project JSON from the Data tab,
            or take a self-contained notebook into Jupyter or notebook.link.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="about-dialog">
          <DialogTitle>Marketing science, on your terms.</DialogTitle>
          <DialogDescription>
            Mixlab is an experimental, open-source workbench for browser-based
            Bayesian marketing mix modeling.
          </DialogDescription>
          <p>
            The real PyMC-Marketing model runs in a local Python/WebAssembly
            worker, with nuts-rs providing NUTS sampling. Data and results stay
            on this device, with a session backup saved in this tab.
          </p>
          <p>
            First use downloads approximately 120 MB of runtime assets. Chains
            run sequentially. The guided workspace restores after reload when
            the local save succeeds. Export before closing the tab; live Python
            sessions are not restored.
          </p>
          <p>
            Our example uses synthetic marketing data, rescaled from the
            nuts-rs-wasm MMM example. Diagnostics and predictions are computed
            from your actual run.
          </p>
          <div className="about-links">
            <a
              href="https://github.com/pymc-labs/nuts-rs-wasm"
              target="_blank"
              rel="noreferrer"
            >
              nuts-rs-wasm <ExternalLink size={14} />
            </a>
            <a
              href="/runtime/third-party-licenses/manifest.json"
              target="_blank"
              rel="noreferrer"
            >
              Runtime licenses <ExternalLink size={14} />
            </a>
            <a href="/LICENSE.txt" target="_blank" rel="noreferrer">
              Mixlab license <ExternalLink size={14} />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
