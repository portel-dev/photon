import { describe, expect, test, vi, afterEach } from 'vitest';
import { handleConfigRoutes } from '../src/auto-ui/beam/routes/api-config.js';

function response() {
  return {
    headers: {} as Record<string, string>,
    statusCode: 200,
    setHeader(name: string, val: string) {
      this.headers[name] = val;
    },
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      Object.assign(this.headers, headers);
    },
    end(body: string) {
      (this as any).body = body;
    },
  };
}

function gatewayState(executeTool = vi.fn()) {
  return {
    photonMCPs: new Map([['my-app', { name: 'my-app', instance: {} }]]),
    apiRateLimiter: { isAllowed: () => true },
    loader: { executeTool },
  };
}

describe('Public REST Gateway and Swagger UI', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  test('serves Swagger UI html page at /api/docs', async () => {
    const req: any = { method: 'GET', headers: {} };
    const res: any = {
      headers: {} as Record<string, string>,
      statusCode: 200,
      setHeader(name: string, val: string) {
        this.headers[name] = val;
      },
      writeHead(code: number) {
        this.statusCode = code;
      },
      end(body: string) {
        this.body = body;
      },
    };
    const url = new URL('http://localhost/api/docs');
    const state: any = {};

    const handled = await handleConfigRoutes(req, res, url, state);
    expect(handled).toBe(true);
    expect(res.headers['Content-Type']).toBe('text/html');
    expect(res.body).toContain('/api/openapi.json');
    expect(res.body).toContain('swagger-ui');
  });

  test('REST gateway parses token and maps calls to loader.executeTool', async () => {
    const req: any = {
      method: 'POST',
      headers: {
        authorization: 'Bearer my-api-token',
      },
      on(event: string, cb: any) {
        if (event === 'data') {
          cb(Buffer.from('{"msg": "hello"}'));
        }
        if (event === 'end') {
          cb();
        }
      },
    };

    vi.stubEnv('PHOTON_MCP_BEARER', 'my-api-token');

    const res: any = {
      headers: {} as Record<string, string>,
      statusCode: 200,
      setHeader(name: string, val: string) {
        this.headers[name] = val;
      },
      writeHead(code: number, headers: any) {
        this.statusCode = code;
        Object.assign(this.headers, headers);
      },
      end(body: string) {
        this.body = body;
      },
    };
    const url = new URL('http://localhost/api/v1/photon/my-app/tools/echo');

    const executeToolMock = vi.fn().mockResolvedValue({ message: 'echoed: hello' });
    const state: any = {
      photonMCPs: {
        get(name: string) {
          if (name === 'my-app') return { name: 'my-app', instance: {} };
          return null;
        },
      },
      apiRateLimiter: {
        isAllowed: () => true,
      },
      loader: {
        executeTool: (mcp: any, name: string, args: any, opts: any) =>
          executeToolMock(mcp, name, args, opts),
      },
    };

    const handled = await handleConfigRoutes(req, res, url, state);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);

    // Verify loader executeTool call arguments
    expect(executeToolMock).toHaveBeenCalled();
    const calls = executeToolMock.mock.calls[0];
    expect(calls[1]).toBe('echo'); // toolName
    expect(calls[3].caller.claims.token).toBe('my-api-token'); // token mapping

    const response = JSON.parse(res.body);
    expect(response.result.message).toBe('echoed: hello');
  });

  test('REST gateway rejects GET without executing a tool', async () => {
    const executeTool = vi.fn();
    const req: any = { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res: any = response();
    await handleConfigRoutes(
      req,
      res,
      new URL('http://localhost/api/v1/photon/my-app/tools/echo'),
      gatewayState(executeTool) as any
    );
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
    expect(executeTool).not.toHaveBeenCalled();
  });

  test('REST gateway requires the CSRF header for local calls', async () => {
    const executeTool = vi.fn();
    const req: any = { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } };
    const res: any = response();
    await handleConfigRoutes(
      req,
      res,
      new URL('http://localhost/api/v1/photon/my-app/tools/echo'),
      gatewayState(executeTool) as any
    );
    expect(res.statusCode).toBe(403);
    expect(executeTool).not.toHaveBeenCalled();
  });

  test('REST gateway rejects invalid bearer credentials', async () => {
    vi.stubEnv('PHOTON_MCP_BEARER', 'expected-token');
    const executeTool = vi.fn();
    const req: any = {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-token' },
      socket: { remoteAddress: '203.0.113.4' },
      on(event: string, cb: () => void) {
        if (event === 'end') cb();
      },
    };
    const res: any = response();
    await handleConfigRoutes(
      req,
      res,
      new URL('http://localhost/api/v1/photon/my-app/tools/echo'),
      gatewayState(executeTool) as any
    );
    expect(res.statusCode).toBe(401);
    expect(executeTool).not.toHaveBeenCalled();
  });
});
