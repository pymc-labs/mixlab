import { useEffect, useRef, useState } from 'react';
import { createSampler } from '../vendor/nuts-rs-wasm/client.mjs';
import { wrap } from '../vendor/nuts-rs-wasm/comlink.mjs';
import { labPayload } from '../lib/exports';
import type { Config, Dataset, RawTable } from '../lib/core';

export type PythonDraft = {
  source: string;
  varNames: string[];
  analysis: string;
};
export function usePythonWorkspace(
  table: RawTable,
  data: Dataset | null,
  config: Config,
) {
  const [draft, setDraft] = useState<PythonDraft>({
    source: '',
    varNames: [],
    analysis: '',
  });
  const [output, setOutput] = useState(''),
    [status, setStatus] = useState('No custom model run yet.'),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const sampler = useRef<
      | (ReturnType<typeof createSampler> & {
          handlers?: { onOutput: (text: string) => void } | null;
        })
      | null
    >(null),
    ctrl = useRef<AbortController | null>(null),
    active = useRef(false);
  const fittedSource = useRef(''),
    fittedData = useRef('');
  const identity = JSON.stringify(table);
  const fresh =
    ready &&
    fittedSource.current === draft.source &&
    fittedData.current === identity;
  useEffect(
    () => () => {
      ctrl.current?.abort();
      sampler.current?.close();
    },
    [],
  );
  function seed() {
    if (!data)
      throw Error(
        'Validate the guided data first, or ask the assistant to draft a custom model for the original CSV.',
      );
    const p = labPayload(data, config);
    setDraft({
      source: p.source,
      varNames: p.varNames,
      analysis: 'print(idata.posterior.sizes)\n',
    });
  }
  function stop() {
    ctrl.current?.abort();
    sampler.current?.close();
    setReady(false);
  }
  const log = (text: string) =>
    setOutput((previous) => (previous + text).slice(-60000));
  async function run(cell?: string) {
    if (active.current) throw Error('Python is already running.');
    if (cell !== undefined && !fresh)
      throw Error(
        'Run the current custom model first. Its kernel must match the current code and dataset.',
      );
    if (cell === undefined && !draft.source.trim())
      throw Error('Draft a model first.');
    active.current = true;
    setBusy(true);
    setStatus(
      cell === undefined ? 'Preparing custom model…' : 'Running analysis…',
    );
    ctrl.current = new AbortController();
    try {
      if (cell !== undefined) {
        sampler.current!.handlers = { onOutput: log };
        await sampler.current!.execute(cell);
      } else {
        setReady(false);
        setOutput('');
        sampler.current?.close();
        sampler.current = createSampler({
          wrap,
          runtimeUrl: '/runtime/',
          environment: 'pymc-marketing-wasm',
          assetsUrl: new URL('/nuts/', location.href),
        });
        const csvCell = (v: string) => '"' + v.replaceAll('"', '""') + '"';
        const raw = [
          table.headers.map(csvCell).join(','),
          ...table.rows.map((row) =>
            table.headers.map((h) => csvCell(row[h] ?? '')).join(','),
          ),
        ].join('\n');
        const files: Record<string, string> = { '/mixlab-raw.csv': raw };
        if (data) files['/mixlab-data.csv'] = labPayload(data, config).csv;
        await sampler.current.sample(draft.source, {
          ...config,
          varNames: draft.varNames,
          files,
          signal: ctrl.current.signal,
          afterSample: draft.analysis,
          onOutput: log,
          onPhase: setStatus,
        });
        fittedSource.current = draft.source;
        fittedData.current = identity;
        setReady(true);
      }
      if (ctrl.current.signal.aborted) throw Error('Python run stopped.');
      setStatus(
        'Complete. Review the Python output; custom results are separate from the guided charts.',
      );
      return {
        status: 'complete',
        note: 'Output remains local. Ask to share Python output if interpretation is needed.',
      };
    } catch (e) {
      const message = ctrl.current?.signal.aborted
        ? 'Python run stopped.'
        : e instanceof Error
          ? e.message
          : String(e);
      setStatus(message);
      log('\n' + message);
      setReady(false);
      return {
        status: 'failed',
        note: 'Review local Python output for details. It is not sent automatically.',
      };
    } finally {
      if (sampler.current) sampler.current.handlers = null;
      active.current = false;
      setBusy(false);
    }
  }
  // Abort also interrupts a follow-up execute call, which does not take a signal.
  useEffect(() => {
    if (!busy) return;
    const signal = ctrl.current?.signal;
    const close = () => sampler.current?.close();
    signal?.addEventListener('abort', close, { once: true });
    return () => signal?.removeEventListener('abort', close);
  }, [busy]);
  return { draft, setDraft, seed, output, status, busy, fresh, run, stop };
}
