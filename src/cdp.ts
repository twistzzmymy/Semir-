import WebSocket from 'ws';
import { DEFAULT_LOGIN_URL } from './api.js';
import { AuthRequiredError, CommandExecutionError } from './errors.js';

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface RuntimeEvaluateResponse {
  id: number;
  result?: {
    result?: {
      type?: string;
      subtype?: string;
      value?: unknown;
      description?: string;
    };
    exceptionDetails?: {
      text?: string;
      exception?: { description?: string };
    };
  };
  error?: { message?: string };
}

export interface CdpConnectOptions {
  cdpUrl: string;
  urlPrefix: string;
  loginUrl?: string;
  loginTimeoutMs?: number;
  loginPollMs?: number;
  onLoginWait?: (status: SemirLoginStatus) => void;
}

export interface SemirLoginStatus {
  loggedIn: boolean;
  status?: number;
  href?: string;
  onLoginPage?: boolean;
  message?: string;
}

export class CdpPage {
  private nextId = 1;

  private constructor(private readonly socket: WebSocket) {}

  static async connect(options: CdpConnectOptions): Promise<CdpPage> {
    const target = await ensureCdpTarget({
      cdpUrl: options.cdpUrl,
      urlPrefix: options.urlPrefix,
      loginUrl: options.loginUrl ?? DEFAULT_LOGIN_URL
    });
    if (!target.webSocketDebuggerUrl) throw new CommandExecutionError(`Chrome tab ${target.id} has no debugger URL`);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const page = new CdpPage(socket);
    await waitForSemirLogin(page, {
      timeoutMs: options.loginTimeoutMs ?? 300_000,
      pollMs: options.loginPollMs ?? 2_000,
      onLoginWait: options.onLoginWait
    });
    return page;
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }

  async evaluate(expression: string): Promise<unknown> {
    const id = this.nextId++;
    const payload = {
      id,
      method: 'Runtime.evaluate',
      params: {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: false
      }
    };
    const response = await new Promise<RuntimeEvaluateResponse>((resolve, reject) => {
      const onMessage = (data: WebSocket.RawData) => {
        let msg: RuntimeEvaluateResponse;
        try {
          msg = JSON.parse(String(data)) as RuntimeEvaluateResponse;
        } catch {
          return;
        }
        if (msg.id !== id) return;
        this.socket.off('message', onMessage);
        resolve(msg);
      };
      this.socket.on('message', onMessage);
      this.socket.send(JSON.stringify(payload), (error) => {
        if (error) {
          this.socket.off('message', onMessage);
          reject(error);
        }
      });
    });
    if (response.error) throw new CommandExecutionError(response.error.message ?? 'CDP Runtime.evaluate failed');
    const exception = response.result?.exceptionDetails;
    if (exception) {
      throw new CommandExecutionError(exception.exception?.description ?? exception.text ?? 'page evaluation failed');
    }
    const result = response.result?.result;
    if (result?.subtype === 'error') throw new CommandExecutionError(result.description ?? 'page evaluation failed');
    return result?.value;
  }

  async fetchJson(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
    const response = await this.evaluate(`(async () => {
      const inputPath = ${JSON.stringify(path)};
      const init = ${JSON.stringify(init)};
      const response = await fetch(inputPath, {
        method: init.method || 'GET',
        credentials: 'include',
        headers: Object.assign({ accept: 'application/json' }, init.headers || {}),
        body: init.body
      });
      const text = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type') || '',
        text
      };
    })()`) as { status?: number; ok?: boolean; contentType?: string; text?: string };

    if (response.status === 401 || response.status === 403) throw new AuthRequiredError();
    if (!response.ok) throw new CommandExecutionError(`森马云盘请求失败: HTTP ${response.status}`);
    const text = response.text ?? '';
    try {
      return JSON.parse(text);
    } catch {
      throw new CommandExecutionError(`森马云盘返回非 JSON 响应: ${text.slice(0, 120)}`);
    }
  }
}

export async function ensureCdpTarget(options: { cdpUrl: string; urlPrefix: string; loginUrl: string }): Promise<CdpTarget> {
  const targets = await listTargets(options.cdpUrl);
  const existing = findCdpTarget(targets, options.urlPrefix);
  if (existing) return existing;
  return await openCdpTarget(options.cdpUrl, options.loginUrl);
}

export async function listTargets(cdpUrl: string): Promise<CdpTarget[]> {
  const base = cdpUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/json/list`);
  if (!response.ok) throw new CommandExecutionError(`无法连接 Chrome CDP: HTTP ${response.status}`);
  return await response.json() as CdpTarget[];
}

export async function openCdpTarget(cdpUrl: string, url: string): Promise<CdpTarget> {
  const endpoint = buildNewTargetEndpoint(cdpUrl, url);
  let response = await fetch(endpoint, { method: 'PUT' });
  if (!response.ok) {
    response = await fetch(endpoint);
  }
  if (!response.ok) throw new CommandExecutionError(`无法在 9222 浏览器打开森马云盘: HTTP ${response.status}`);
  const target = await response.json() as CdpTarget;
  if (target.webSocketDebuggerUrl) return target;

  const targets = await listTargets(cdpUrl);
  const found = targets.find((item) => item.id === target.id) ?? findCdpTarget(targets, url);
  if (!found) throw new CommandExecutionError('已请求打开森马云盘，但未在 CDP target 列表找到新页面');
  return found;
}

export function buildNewTargetEndpoint(cdpUrl: string, url: string): string {
  return `${cdpUrl.replace(/\/$/, '')}/json/new?${encodeURIComponent(url)}`;
}

export function findCdpTarget(targets: CdpTarget[], urlPrefix: string): CdpTarget | null {
  const pages = targets.filter((target) => target.type === 'page' && target.url.startsWith(urlPrefix));
  if (!pages.length) return null;
  const titled = pages.find((target) => target.title.includes('森马云盘'));
  return titled ?? pages[0];
}

export function selectCdpTarget(targets: CdpTarget[], urlPrefix: string): CdpTarget {
  const target = findCdpTarget(targets, urlPrefix);
  if (!target) {
    throw new CommandExecutionError(`No Chrome tab matches ${urlPrefix}. 请确认 9222 浏览器里打开并登录了森马云盘。`);
  }
  return target;
}

export async function probeSemirLogin(page: CdpPage): Promise<SemirLoginStatus> {
  const raw = await page.evaluate(`(async () => {
    const href = location.href || '';
    try {
      const response = await fetch('/fengcloud/1/account/mount', {
        credentials: 'include',
        headers: { accept: 'application/json' }
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: response.status, ok: response.ok, json, text: text.slice(0, 240), href };
    } catch (error) {
      const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 240);
      return { status: 0, ok: false, href, text: bodyText, message: String(error?.message || error) };
    }
  })()`);
  return normalizeLoginProbe(raw);
}

export function normalizeLoginProbe(value: unknown): SemirLoginStatus {
  const probe = (value && typeof value === 'object' ? value : {}) as {
    status?: unknown;
    ok?: unknown;
    json?: unknown;
    text?: unknown;
    href?: unknown;
    message?: unknown;
  };
  const status = Number(probe.status ?? 0);
  const href = String(probe.href ?? '');
  const text = String(probe.text ?? '');
  const mountList = (probe.json as { list?: unknown } | null | undefined)?.list;
  const loggedIn = probe.ok === true && Array.isArray(mountList);
  const onLoginPage = /login|signin|passport|auth/i.test(href) || /登录|扫码登录|账号登录|验证码|请先登录/.test(text);
  return {
    loggedIn,
    status: Number.isFinite(status) ? status : undefined,
    href,
    onLoginPage,
    message: typeof probe.message === 'string' ? probe.message : undefined
  };
}

export async function waitForSemirLogin(
  page: CdpPage,
  options: { timeoutMs: number; pollMs: number; onLoginWait?: (status: SemirLoginStatus) => void }
): Promise<SemirLoginStatus> {
  const deadline = Date.now() + Math.max(0, options.timeoutMs);
  let notified = false;
  let lastStatus: SemirLoginStatus = { loggedIn: false };

  while (Date.now() <= deadline) {
    lastStatus = await probeSemirLogin(page);
    if (lastStatus.loggedIn) return lastStatus;
    if (!notified) {
      options.onLoginWait?.(lastStatus);
      notified = true;
    }
    await sleep(Math.max(250, options.pollMs));
  }

  throw new AuthRequiredError('森马云盘尚未登录或登录等待超时。请在 9222 浏览器打开的森马云盘页面完成登录后重试。');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
