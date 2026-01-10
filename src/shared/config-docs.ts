import type { ConstructorParam } from '@portel/photon-core';

export interface MissingParamInfo {
  paramName: string;
  envVarName: string;
  type: string;
}

export function toEnvVarName(mcpName: string, paramName: string): string {
  const mcpPrefix = mcpName.toUpperCase().replace(/-/g, '_');
  const paramSuffix = paramName
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
  return `${mcpPrefix}_${paramSuffix}`;
}

export function generateExampleValue(paramName: string, paramType: string): string | null {
  const lowerName = paramName.toLowerCase();

  if (lowerName.includes('apikey') || lowerName.includes('api_key')) {
    return 'sk_your_api_key_here';
  }
  if (lowerName.includes('token') || lowerName.includes('secret')) {
    return 'your_secret_token';
  }
  if (lowerName.includes('url') || lowerName.includes('endpoint')) {
    return 'https://api.example.com';
  }
  if (lowerName.includes('host') || lowerName.includes('server')) {
    return 'localhost';
  }
  if (lowerName.includes('port')) {
    return '5432';
  }
  if (lowerName.includes('database') || lowerName.includes('db')) {
    return 'my_database';
  }
  if (lowerName.includes('user') || lowerName.includes('username')) {
    return 'admin';
  }
  if (lowerName.includes('password')) {
    return 'your_secure_password';
  }
  if (lowerName.includes('path') || lowerName.includes('dir')) {
    return '/path/to/directory';
  }
  if (lowerName.includes('name')) {
    return 'my-service';
  }
  if (lowerName.includes('region')) {
    return 'us-east-1';
  }
  if (paramType === 'boolean') {
    return 'true';
  }
  if (paramType === 'number') {
    return '3000';
  }

  return null;
}

export function summarizeConstructorParams(
  params: ConstructorParam[],
  mcpName: string
): { docs: string; exampleEnv: Record<string, string> } {
  const docs = params.map(param => {
    const envVarName = toEnvVarName(mcpName, param.name);
    const required = !param.isOptional && !param.hasDefault;
    const status = required ? '[REQUIRED]' : '[OPTIONAL]';
    const defaultInfo = param.hasDefault ? ` (default: ${JSON.stringify(param.defaultValue)})` : '';
    const exampleValue = generateExampleValue(param.name, param.type);

    let line = `  • ${envVarName} ${status}`;
    line += `\n    Type: ${param.type}${defaultInfo}`;
    if (exampleValue) {
      line += `\n    Example: ${envVarName}="${exampleValue}"`;
    }
    return line;
  }).join('\n\n');

  const exampleEnv: Record<string, string> = {};
  params.forEach(param => {
    const envVarName = toEnvVarName(mcpName, param.name);
    if (!param.isOptional && !param.hasDefault) {
      exampleEnv[envVarName] = generateExampleValue(param.name, param.type) || `your-${param.name}`;
    }
  });

  return { docs, exampleEnv };
}

export function generateConfigErrorMessage(
  mcpName: string,
  missing: MissingParamInfo[]
): string {
  const envVarList = missing.map(m => `  • ${m.envVarName} (${m.paramName}: ${m.type})`).join('\n');
  const exampleEnv = Object.fromEntries(
    missing.map(m => [m.envVarName, `<your-${m.paramName}>`])
  );

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  Configuration Warning: ${mcpName} MCP

Missing required environment variables:
${envVarList}

Tools will fail until configuration is fixed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To fix, add environment variables to your MCP client config:

{
  "mcpServers": {
    "${mcpName}": {
      "command": "npx",
      "args": ["@portel/photon", "${mcpName}"],
      "env": ${JSON.stringify(exampleEnv, null, 8).replace(/\n/g, '\n      ')}
    }
  }
}

Or run: photon ${mcpName} --config

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
}
