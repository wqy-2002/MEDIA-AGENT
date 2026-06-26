import type { ActionResult, AutomationDiagnostics } from '@/types';
import { collectDiagnostics, formatDiagnostics } from './diagnostics';
import { sleep } from '@/utils/dom';

// 通用状态机 runner：平台层只需定义状态检测、状态动作、终态和失败态。

export interface StateMachineStep<TState extends string, TContext> {
  state: TState;
  description: string;
  run: (ctx: TContext) => Promise<ActionResult | void>;
}

export interface StateMachineConfig<TState extends string, TContext> {
  name: string;
  ctx: TContext;
  detect: (ctx: TContext) => Promise<TState> | TState;
  terminalStates: TState[];
  blockedStates?: TState[];
  steps: Partial<Record<TState, StateMachineStep<TState, TContext>>>;
  maxTransitions?: number;
  delayMs?: number;
  /** 每步转移后的延迟；优先于固定 delayMs */
  getDelayMs?: () => number | Promise<number>;
}

function withDiagnostics(state: string, message: string, diagnostics?: AutomationDiagnostics): ActionResult {
  const diag = diagnostics ?? collectDiagnostics(state);
  return {
    success: false,
    errorCode: 'PLATFORM_PAGE_CHANGED',
    message: `${message}\n${formatDiagnostics(diag)}`,
    diagnostics: diag,
  };
}

/** 执行状态机直到终态、阻塞态或超出最大步数 */
export async function runStateMachine<TState extends string, TContext>(
  config: StateMachineConfig<TState, TContext>,
): Promise<ActionResult> {
  const maxTransitions = config.maxTransitions ?? 30;
  const defaultDelayMs = config.delayMs ?? 300;
  const visited: TState[] = [];

  for (let i = 0; i < maxTransitions; i++) {
    const state = await config.detect(config.ctx);
    visited.push(state);

    if (config.terminalStates.includes(state)) {
      return {
        success: true,
        message: `${config.name} 已到达终态: ${state}`,
        data: { state, visited },
        diagnostics: collectDiagnostics(state),
      };
    }

    if (config.blockedStates?.includes(state)) {
      return withDiagnostics(state, `${config.name} 被阻塞: ${state}`);
    }

    const step = config.steps[state];
    if (!step) {
      return withDiagnostics(state, `${config.name} 未定义状态处理器: ${state}`);
    }

    const result = await step.run(config.ctx);
    if (result && !result.success) {
      return {
        ...result,
        diagnostics: result.diagnostics ?? collectDiagnostics(state),
      };
    }
    const delayMs = config.getDelayMs
      ? await config.getDelayMs()
      : defaultDelayMs;
    await sleep(delayMs);
  }

  const last = visited[visited.length - 1] ?? 'unknown';
  return withDiagnostics(
    last,
    `${config.name} 超出最大状态转移次数: ${visited.join(' -> ')}`,
  );
}

