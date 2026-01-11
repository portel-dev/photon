/**
 * Table Component
 * Renders tabular data with support for sorting, filtering, and pagination
 */

import { UIComponent, ComponentProps } from '../types';
import Table from 'cli-table3';
import chalk from 'chalk';

export class TableComponent implements UIComponent {
  supportsFormat(format: 'cli' | 'mcp' | 'web'): boolean {
    return true;
  }

  render(props: ComponentProps): string | object {
    const { data, metadata, context } = props;

    if (context.format === 'cli') {
      return this.renderCLI(data, metadata);
    } else if (context.format === 'mcp') {
      return this.renderMCP(data, metadata);
    } else {
      return this.renderWeb(data, metadata);
    }
  }

  private renderCLI(data: any[], metadata: any): string {
    if (!Array.isArray(data) || data.length === 0) {
      return chalk.gray('(no data)');
    }

    const columns = metadata.columns || Object.keys(data[0]);
    
    const table = new Table({
      head: columns.map((col: string) => chalk.cyan(col)),
      style: {
        head: [],
        border: []
      }
    });

    data.forEach(row => {
      const values = columns.map((col: string) => {
        const value = row[col];
        if (value === null || value === undefined) {
          return chalk.gray('-');
        }
        if (typeof value === 'object') {
          return chalk.gray(JSON.stringify(value));
        }
        return String(value);
      });
      table.push(values);
    });

    return table.toString();
  }

  private renderMCP(data: any[], metadata: any): object {
    const columns = metadata.columns || (data.length > 0 ? Object.keys(data[0]) : []);
    
    return {
      type: 'table',
      columns,
      rows: data,
      metadata: {
        sortable: metadata.sortable ?? false,
        filterable: metadata.filterable ?? false,
        paginated: metadata.paginated ?? false,
        title: metadata.title
      }
    };
  }

  private renderWeb(data: any[], metadata: any): object {
    const columns = metadata.columns || (data.length > 0 ? Object.keys(data[0]) : []);
    
    return {
      component: 'Table',
      props: {
        columns: columns.map((col: string) => ({
          key: col,
          label: col,
          sortable: metadata.sortable ?? true
        })),
        data,
        title: metadata.title,
        filterable: metadata.filterable ?? true,
        paginated: metadata.paginated ?? true
      }
    };
  }
}
