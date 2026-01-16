/**
 * Form Component
 * Renders interactive forms for input collection
 */

import { UIComponent, ComponentProps } from '../types';
import inquirer from 'inquirer';

export class FormComponent implements UIComponent {
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

  private renderCLI(schema: any, metadata: any): string {
    return JSON.stringify(schema, null, 2);
  }

  async collectInput(schema: any): Promise<any> {
    const questions = schema.properties
      ? Object.entries(schema.properties).map(([key, prop]: [string, any]) => ({
          type: this.getInputType(prop.type),
          name: key,
          message: prop.description || key,
          default: prop.default,
          validate: prop.required
            ? (input: any) => (input ? true : `${key} is required`)
            : undefined,
        }))
      : [];

    return inquirer.prompt(questions);
  }

  private getInputType(type: string): string {
    switch (type) {
      case 'boolean':
        return 'confirm';
      case 'number':
        return 'number';
      case 'array':
        return 'checkbox';
      default:
        return 'input';
    }
  }

  private renderMCP(schema: any, metadata: any): object {
    return {
      type: 'form',
      schema,
      metadata: {
        title: metadata.title,
        description: metadata.description,
      },
    };
  }

  private renderWeb(schema: any, metadata: any): object {
    return {
      component: 'Form',
      props: {
        schema,
        title: metadata.title,
        description: metadata.description,
      },
    };
  }
}
