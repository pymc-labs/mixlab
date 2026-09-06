/** Type boundary for the unmodified upstream JavaScript client. */
export interface SamplerOptions {
  runtimeUrl: string;
  environment: string;
  assetsUrl?: string | URL;
  wrap?: unknown;
  comlinkUrl?: string | URL;
  loadTimeout?: number;
}
export interface SampleOptions {
  chains?: number;
  tune?: number;
  draws?: number;
  seed?: number;
  targetAccept?: number;
  varNames?: string[] | null;
  files?: Record<string, string>;
  signal?: AbortSignal;
  afterSample?: string;
  onPhase?: (phase: string) => void;
  onOutput?: (text: string) => void;
  onProgress?: (progress: {
    chain: number;
    index: number;
    tuning: boolean;
  }) => void;
  onSamples?: (samples: {
    chain: number;
    start: number;
    draws: number;
    values: Float64Array;
    layout: { name: string; size: number }[];
  }) => void;
}
export interface SampleResult {
  traces: { chain: number; group: string; bytes: Uint8Array }[];
  compile_seconds: number;
  sampling_seconds: number;
}
export class BrowserSampler {
  constructor(options: SamplerOptions);
  wrap: unknown;
  assets: URL;
  sample(source: string, options?: SampleOptions): Promise<SampleResult>;
  execute(source: string): Promise<void>;
  close(): void;
}
export function createSampler(options: SamplerOptions): BrowserSampler;
