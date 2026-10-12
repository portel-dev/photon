import type { AskYield, InputProvider } from '@portel/photon-core';
import { prompt as elicitPrompt, confirm as elicitConfirm } from '@portel/photon-core';

export interface CliInputRuntime {
  doneProgress(): void;
  warn(message: string): void;
}

export function createCliInputProvider(runtime: CliInputRuntime): InputProvider {
  return async (ask: AskYield): Promise<any> => {
    runtime.doneProgress();
    switch (ask.ask) {
      case 'text':
      case 'password':
        return await elicitPrompt(ask.message, 'default' in ask ? ask.default : undefined);
      case 'confirm':
        return await elicitConfirm(ask.message);
      case 'select': {
        const options = (ask.options || []).map((option: any) =>
          typeof option === 'string'
            ? { value: option, label: option }
            : { value: option.value ?? option.label, label: option.label }
        );
        let message = `${ask.message}\n`;
        options.forEach((option, index) => {
          message += `  [${index + 1}] ${option.label}\n`;
        });
        message += ask.multi
          ? 'Select option(s) (comma-separated numbers or names): '
          : 'Select an option (number or name): ';
        const result = await elicitPrompt(message);
        if (!result) return ask.multi ? [] : null;
        const resolve = (part: string) => {
          const index = Number.parseInt(part, 10) - 1;
          if (index >= 0 && index < options.length) return options[index].value;
          const normalized = part.toLowerCase();
          return options.find(
            (option) =>
              option.label.toLowerCase() === normalized ||
              option.value.toString().toLowerCase() === normalized ||
              option.label.toLowerCase().includes(normalized)
          )?.value;
        };
        if (ask.multi)
          return result
            .split(',')
            .map((part) => resolve(part.trim().toLowerCase()))
            .filter((value) => value !== undefined);
        return resolve(result.trim().toLowerCase()) ?? result;
      }
      case 'number': {
        const result = await elicitPrompt(ask.message, ask.default?.toString());
        return result ? parseFloat(result) : (ask.default ?? 0);
      }
      case 'date': {
        const result = await elicitPrompt(ask.message, ask.default);
        return result || ask.default || new Date().toISOString();
      }
      case 'file':
        runtime.warn(`File selection not supported in CLI: ${ask.message}`);
        return null;
      default:
        runtime.warn(`Unknown ask type: ${(ask as { ask?: string }).ask || 'unknown'}`);
        return undefined;
    }
  };
}
