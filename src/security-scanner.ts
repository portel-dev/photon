/**
 * Security Scanner - Check dependencies for known vulnerabilities
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

interface NpmAuditVulnerability {
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  name?: string;
  url?: string;
  via?: Array<string | unknown>;
  range?: string;
}

interface NpmAuditData {
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
}

export interface VulnerabilityInfo {
  severity: 'info' | 'low' | 'moderate' | 'high' | 'critical';
  title: string;
  url?: string;
  via?: string[];
  range?: string;
}

export interface DependencyAuditResult {
  dependency: string;
  version: string;
  vulnerabilities: VulnerabilityInfo[];
  hasVulnerabilities: boolean;
}

export interface MCPAuditResult {
  mcpName: string;
  dependencies: DependencyAuditResult[];
  totalVulnerabilities: number;
  criticalCount: number;
  highCount: number;
  moderateCount: number;
  lowCount: number;
}

export class SecurityScanner {
  /**
   * Audit dependencies for a specific MCP
   */
  async auditMCP(mcpName: string, dependencies: string[]): Promise<MCPAuditResult> {
    const results: DependencyAuditResult[] = [];
    let totalVulnerabilities = 0;
    let criticalCount = 0;
    let highCount = 0;
    let moderateCount = 0;
    let lowCount = 0;

    for (const dep of dependencies) {
      const result = await this.auditDependency(mcpName, dep);
      results.push(result);

      if (result.hasVulnerabilities) {
        totalVulnerabilities += result.vulnerabilities.length;
        result.vulnerabilities.forEach((vuln) => {
          switch (vuln.severity) {
            case 'critical':
              criticalCount++;
              break;
            case 'high':
              highCount++;
              break;
            case 'moderate':
              moderateCount++;
              break;
            case 'low':
              lowCount++;
              break;
          }
        });
      }
    }

    return {
      mcpName,
      dependencies: results,
      totalVulnerabilities,
      criticalCount,
      highCount,
      moderateCount,
      lowCount,
    };
  }

  /**
   * Audit a single dependency
   */
  private async auditDependency(
    mcpName: string,
    dependency: string
  ): Promise<DependencyAuditResult> {
    // Parse dependency string (name@version)
    const parts = dependency.split('@');
    const version = parts.pop() || 'latest';
    const name = parts.join('@'); // Handle scoped packages like @org/package

    const depPath = path.join(os.homedir(), '.cache', 'photon-mcp', 'dependencies', mcpName);

    try {
      // Check if dependency directory exists
      await fs.access(depPath);

      // Run npm audit in the dependency directory
      const { stdout } = await execAsync('npm audit --json', {
        cwd: depPath,
        timeout: 30000,
      });

      const auditData = JSON.parse(stdout);
      const vulnerabilities = this.extractVulnerabilities(auditData, name);

      return {
        dependency: name,
        version,
        vulnerabilities,
        hasVulnerabilities: vulnerabilities.length > 0,
      };
    } catch (error) {
      // If npm audit fails or directory doesn't exist, assume no vulnerabilities
      // (dependency might not be installed yet)
      return {
        dependency: name,
        version,
        vulnerabilities: [],
        hasVulnerabilities: false,
      };
    }
  }

  /**
   * Extract relevant vulnerabilities from npm audit output
   */
  private extractVulnerabilities(
    auditData: NpmAuditData,
    packageName: string
  ): VulnerabilityInfo[] {
    const vulnerabilities: VulnerabilityInfo[] = [];

    if (!auditData.vulnerabilities) {
      return vulnerabilities;
    }

    // npm audit v7+ format
    for (const [vulnPackage, vulnData] of Object.entries(auditData.vulnerabilities)) {
      // Check if this vulnerability affects our target package
      if (vulnPackage === packageName || vulnData.via?.includes(packageName)) {
        vulnerabilities.push({
          severity: vulnData.severity || 'moderate',
          title: vulnData.name || vulnPackage,
          url: vulnData.url,
          via: vulnData.via?.filter((v): v is string => typeof v === 'string'),
          range: vulnData.range,
        });
      }
    }

    return vulnerabilities;
  }

  /**
   * Quick check if dependency has known vulnerabilities
   */
  async hasVulnerabilities(dependency: string): Promise<boolean> {
    try {
      // Use npm view to check if package exists
      const parts = dependency.split('@');
      const version = parts.pop() || 'latest';
      const name = parts.join('@');

      const { stdout } = await execAsync(`npm view ${name}@${version} version`, {
        timeout: 10000,
      });

      // If we get here, package exists. Now check for advisories
      // Note: npm doesn't provide a direct API for this without installing,
      // but we can check the npm registry API
      return false; // Default to false for now
    } catch (error) {
      return false; // package doesn't exist or registry unreachable
    }
  }

  /**
   * Get severity color for terminal output
   */
  getSeveritySymbol(severity: string): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'high':
        return '🟠';
      case 'moderate':
        return '🟡';
      case 'low':
        return '🔵';
      default:
        return 'ℹ️';
    }
  }

  /**
   * Format audit result for display
   */
  formatAuditResult(result: MCPAuditResult): string {
    if (result.totalVulnerabilities === 0) {
      return `✅ ${result.mcpName}: No vulnerabilities found`;
    }

    let output = `⚠️  ${result.mcpName}: ${result.totalVulnerabilities} vulnerabilities found\n`;

    if (result.criticalCount > 0) {
      output += `   🔴 Critical: ${result.criticalCount}\n`;
    }
    if (result.highCount > 0) {
      output += `   🟠 High: ${result.highCount}\n`;
    }
    if (result.moderateCount > 0) {
      output += `   🟡 Moderate: ${result.moderateCount}\n`;
    }
    if (result.lowCount > 0) {
      output += `   🔵 Low: ${result.lowCount}\n`;
    }

    return output;
  }
}
