import { describe, expect, test, vi, afterEach } from 'vitest';
import { handleConfigRoutes } from '../src/auto-ui/beam/routes/api-config.js';

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
});
