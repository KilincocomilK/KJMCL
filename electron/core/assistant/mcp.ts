import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import type { AiMcpSettings } from '../../../shared/assistant';
import { assistantScenarios } from '../../../shared/assistant-scenarios';
import { VERSION } from '../../../shared/version';
import type { Secrets } from '../vault';
import { AssistantStorage } from './storage';
import { AssistantTools, type ToolContext } from './tools';
import { toolInstructions } from './prompts';

type Listener = { server: Server; handler: McpHttpHandler; port: number };
const address = (port: number) => 'http://127.0.0.1:' + port;
const tokenKey = 'ai-mcp-token';
export class LocalMcp {
  private listener?: Listener;
  private token = '';
  private authority = new AbortController();
  private generation = 0;
  private operation?: Promise<void>;
  private issue?: string;
  private disposed = false;
  constructor(
    private storage: AssistantStorage,
    private vault: Secrets,
    private tools: AssistantTools,
    private available: () => boolean,
    private changed: () => void,
  ) {}
  state() {
    const mcp = this.storage.config.mcp;
    return {
      ...mcp,
      url: address(mcp.port) + '/mcp',
      listening: !!this.listener?.server.listening,
      error: this.issue,
    };
  }
  private async open(port: number): Promise<Listener> {
    const [{ createMcpHandler, McpServer }, { toNodeHandler }] = await Promise.all([
      import('@modelcontextprotocol/server'),
      import('@modelcontextprotocol/node'),
    ]);
    const maxRequestBodySize = 64 * 1024;
    const handler = createMcpHandler(
      ({ authInfo }) => {
        if (authInfo?.extra?.generation !== this.generation)
          throw new Error('连接凭据已变化，请重新连接');
        const ctx: ToolContext = {
          source: 'mcp',
          allowChanges: this.storage.config.mcp.allowChanges,
          signal: this.authority.signal,
        };
        const mcp = new McpServer(
          { name: 'kjmcl', title: 'KJMCL 启动器', version: VERSION },
          { instructions: toolInstructions },
        );
        for (const tool of this.tools.available(ctx)) {
          mcp.registerTool(
            tool.name,
            {
              title: tool.title,
              description: tool.description,
              inputSchema: tool.schema,
              annotations: {
                readOnlyHint: !tool.proposes,
                destructiveHint: false,
                openWorldHint: false,
              },
            },
            async (args, request) => {
              try {
                if (!this.available()) throw new Error('启动器正在迁移数据、维护或退出');
                const signal = AbortSignal.any([ctx.signal!, request.mcpReq.signal]);
                const result = await this.tools.call(tool.name, args, { ...ctx, signal });
                return { content: [{ type: 'text', text: JSON.stringify(result) }] };
              } catch (error) {
                return {
                  isError: true,
                  content: [
                    { type: 'text', text: error instanceof Error ? error.message : '工具调用失败' },
                  ],
                };
              }
            },
          );
        }
        for (const scenario of assistantScenarios) {
          mcp.registerPrompt(
            scenario.name,
            { title: scenario.title, description: scenario.text },
            () => ({
              messages: [{ role: 'user', content: { type: 'text', text: scenario.text } }],
            }),
          );
        }
        return mcp;
      },
      { maxRequestBodySize, maxSubscriptions: 4, legacy: 'stateless' },
    );
    const dispatch = toNodeHandler(handler, { maxRequestBodySize });
    const server = createServer(
      { requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 },
      async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        const fail = (status: number) => {
          res.writeHead(status);
          res.end();
        };
        if (req.url !== '/mcp') return fail(404);
        if (
          req.headers.host !== '127.0.0.1:' + port ||
          (req.headers.origin !== undefined && req.headers.origin !== address(port))
        )
          return fail(403);
        if (server !== this.listener?.server || !this.available()) return fail(503);
        const supplied = Buffer.from(req.headers.authorization ?? '');
        const expected = Buffer.from('Bearer ' + this.token);
        if (
          !this.token ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        ) {
          res.setHeader('WWW-Authenticate', 'Bearer realm="KJMCL"');
          return fail(401);
        }
        // Bind authorization to header validation, even when the body arrives after a permission change.
        Object.assign(req, {
          auth: {
            token: '',
            clientId: 'kjmcl-local',
            scopes: [],
            extra: { generation: this.generation },
          },
        });
        try {
          await dispatch(req, res);
        } catch {
          if (!res.headersSent) fail(500);
          else res.destroy();
        }
      },
    );
    server.maxConnections = 24;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
    } catch {
      await handler.close();
      throw new Error('无法监听 MCP 端口 ' + port + '，请更换端口后重试');
    }
    const listener = { server, handler, port };
    server.on('error', () => {
      if (this.listener !== listener) return;
      this.listener = undefined;
      this.issue = 'MCP 服务已中断，请重新启用';
      this.invalidate();
      void this.close(listener);
      this.changed();
    });
    return listener;
  }
  private invalidate() {
    this.generation++;
    this.authority.abort();
    this.authority = new AbortController();
    this.tools.revoke((p) => p.source === 'mcp');
  }
  private async close(listener?: Listener) {
    if (!listener) return;
    const closed = new Promise<void>((resolve) => listener.server.close(() => resolve()));
    listener.server.closeAllConnections();
    await Promise.all([closed, listener.handler.close()]);
  }
  private async exclusive(work: () => Promise<void>) {
    if (this.operation || this.disposed) throw new Error('MCP 服务正在切换');
    this.operation = work();
    try {
      await this.operation;
      this.issue = undefined;
    } catch (e) {
      this.issue = e instanceof Error ? e.message : 'MCP 设置失败';
      throw e;
    } finally {
      this.operation = undefined;
      this.changed();
    }
  }
  async startSaved() {
    if (this.storage.config.mcp.enabled) await this.set(this.storage.config.mcp);
  }
  set(next: AiMcpSettings) {
    return this.exclusive(async () => {
      const old = this.listener;
      let candidate: Listener | undefined;
      let token = this.token;
      if (next.enabled) {
        if (!token) {
          token = (await this.vault.get(tokenKey)) ?? '';
          if (!token) {
            token = randomBytes(32).toString('base64url');
            await this.vault.set(tokenKey, token);
          }
        }
        if (!old || old.port !== next.port) candidate = await this.open(next.port);
      }
      const previous = this.storage.config.mcp;
      try {
        if (this.disposed) throw new Error('启动器正在退出');
        this.storage.configure({ ...this.storage.config, mcp: next });
      } catch (e) {
        await this.close(candidate);
        throw e;
      }
      this.listener = next.enabled ? (candidate ?? old) : undefined;
      this.token = next.enabled ? token : '';
      if (this.listener !== old || previous.allowChanges !== next.allowChanges) this.invalidate();
      if (old !== this.listener) await this.close(old);
    });
  }
  rotate() {
    return this.exclusive(async () => {
      if (!this.listener) throw new Error('请先启用 MCP 服务');
      const token = randomBytes(32).toString('base64url');
      await this.vault.set(tokenKey, token);
      this.token = token;
      this.invalidate();
      this.listener.server.closeAllConnections();
    });
  }
  copy(kind: 'config' | 'token', write: (value: string) => void) {
    if (!this.token || !this.listener || this.operation) throw new Error('请先启用 MCP 服务');
    write(
      kind === 'token'
        ? this.token
        : JSON.stringify(
            {
              mcpServers: {
                kjmcl: {
                  type: 'http',
                  url: address(this.listener.port) + '/mcp',
                  headers: { Authorization: 'Bearer ' + this.token },
                },
              },
            },
            null,
            2,
          ),
    );
  }
  async dispose() {
    this.disposed = true;
    if (this.operation) await this.operation.catch(() => {});
    const listener = this.listener;
    this.listener = undefined;
    this.token = '';
    this.invalidate();
    await this.close(listener);
  }
}
