/**
 * Time Photon MCP - Date and time utilities
 *
 * Provides date/time operations: formatting, parsing, timezone conversion, duration calculations,
 * and relative time formatting. Uses built-in JavaScript Date and Intl APIs.
 *
 * Example: format({ timestamp: 1609459200000, format: "YYYY-MM-DD" }) → "2021-01-01"
 *
 * Run with: npx photon time.photon.ts --dev
 *
 * @version 1.0.0
 * @author Portel
 * @license MIT
 */

export default class Time {
  /**
   * Get current timestamp
   * @param unit Time unit: milliseconds, seconds, or iso (default: milliseconds)
   */
  async now(params: { unit?: 'milliseconds' | 'seconds' | 'iso' }) {
    const now = Date.now();

    switch (params.unit) {
      case 'seconds':
        return { timestamp: Math.floor(now / 1000), unit: 'seconds' };
      case 'iso':
        return { timestamp: new Date(now).toISOString(), unit: 'iso' };
      default:
        return { timestamp: now, unit: 'milliseconds' };
    }
  }

  /**
   * Format a timestamp
   * @param timestamp Timestamp in milliseconds or ISO string
   * @param format Output format: iso, locale, date, time, datetime (default: iso)
   * @param timezone Target timezone (e.g., "America/New_York", default: UTC)
   * @param locale Locale for formatting (e.g., "en-US", default: en-US)
   */
  async format(params: {
    timestamp: number | string;
    format?: 'iso' | 'locale' | 'date' | 'time' | 'datetime';
    timezone?: string;
    locale?: string;
  }) {
    try {
      const date = new Date(params.timestamp);
      const format = params.format || 'iso';
      const locale = params.locale || 'en-US';
      const timezone = params.timezone || 'UTC';

      if (isNaN(date.getTime())) {
        return { success: false, error: 'Invalid timestamp' };
      }

      let formatted: string;

      switch (format) {
        case 'iso':
          formatted = date.toISOString();
          break;
        case 'locale':
          formatted = date.toLocaleString(locale, { timeZone: timezone });
          break;
        case 'date':
          formatted = date.toLocaleDateString(locale, { timeZone: timezone });
          break;
        case 'time':
          formatted = date.toLocaleTimeString(locale, { timeZone: timezone });
          break;
        case 'datetime':
          formatted = date.toLocaleString(locale, {
            timeZone: timezone,
            dateStyle: 'medium',
            timeStyle: 'medium',
          });
          break;
        default:
          formatted = date.toISOString();
      }

      return {
        success: true,
        formatted,
        original: params.timestamp,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse a date string to timestamp
   * @param dateString Date string to parse (ISO format or natural language)
   */
  async parse(params: { dateString: string }) {
    try {
      const date = new Date(params.dateString);

      if (isNaN(date.getTime())) {
        return { success: false, error: 'Invalid date string' };
      }

      return {
        success: true,
        timestamp: date.getTime(),
        iso: date.toISOString(),
        dateString: params.dateString,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Add duration to a timestamp
   * @param timestamp Starting timestamp in milliseconds or ISO string
   * @param value Duration value (can be negative for subtraction)
   * @param unit Duration unit: milliseconds, seconds, minutes, hours, days, weeks, months, years
   */
  async add(params: {
    timestamp: number | string;
    value: number;
    unit: 'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';
  }) {
    try {
      const date = new Date(params.timestamp);

      if (isNaN(date.getTime())) {
        return { success: false, error: 'Invalid timestamp' };
      }

      switch (params.unit) {
        case 'milliseconds':
          date.setMilliseconds(date.getMilliseconds() + params.value);
          break;
        case 'seconds':
          date.setSeconds(date.getSeconds() + params.value);
          break;
        case 'minutes':
          date.setMinutes(date.getMinutes() + params.value);
          break;
        case 'hours':
          date.setHours(date.getHours() + params.value);
          break;
        case 'days':
          date.setDate(date.getDate() + params.value);
          break;
        case 'weeks':
          date.setDate(date.getDate() + params.value * 7);
          break;
        case 'months':
          date.setMonth(date.getMonth() + params.value);
          break;
        case 'years':
          date.setFullYear(date.getFullYear() + params.value);
          break;
      }

      return {
        success: true,
        timestamp: date.getTime(),
        iso: date.toISOString(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate difference between two timestamps
   * @param start Start timestamp in milliseconds or ISO string
   * @param end End timestamp in milliseconds or ISO string
   * @param unit Unit for the result: milliseconds, seconds, minutes, hours, days (default: milliseconds)
   */
  async diff(params: {
    start: number | string;
    end: number | string;
    unit?: 'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days';
  }) {
    try {
      const startDate = new Date(params.start);
      const endDate = new Date(params.end);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return { success: false, error: 'Invalid timestamp' };
      }

      const diffMs = endDate.getTime() - startDate.getTime();
      const unit = params.unit || 'milliseconds';

      let value: number;

      switch (unit) {
        case 'milliseconds':
          value = diffMs;
          break;
        case 'seconds':
          value = diffMs / 1000;
          break;
        case 'minutes':
          value = diffMs / (1000 * 60);
          break;
        case 'hours':
          value = diffMs / (1000 * 60 * 60);
          break;
        case 'days':
          value = diffMs / (1000 * 60 * 60 * 24);
          break;
      }

      return {
        success: true,
        difference: value,
        unit,
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Convert timestamp to different timezone
   * @param timestamp Timestamp in milliseconds or ISO string
   * @param timezone Target timezone (e.g., "America/New_York", "Europe/London")
   * @param format Output format (default: locale)
   */
  async timezone(params: {
    timestamp: number | string;
    timezone: string;
    format?: 'iso' | 'locale' | 'offset';
  }) {
    try {
      const date = new Date(params.timestamp);

      if (isNaN(date.getTime())) {
        return { success: false, error: 'Invalid timestamp' };
      }

      const format = params.format || 'locale';

      if (format === 'offset') {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: params.timezone,
          timeZoneName: 'longOffset',
        });
        const parts = formatter.formatToParts(date);
        const offsetPart = parts.find((p) => p.type === 'timeZoneName');

        return {
          success: true,
          timezone: params.timezone,
          offset: offsetPart?.value || 'UTC',
          timestamp: date.getTime(),
        };
      }

      const formatted = date.toLocaleString('en-US', {
        timeZone: params.timezone,
        dateStyle: 'full',
        timeStyle: 'full',
      });

      return {
        success: true,
        timezone: params.timezone,
        formatted,
        iso: date.toISOString(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Validate if a date string is valid
   * @param dateString Date string to validate
   */
  async isValid(params: { dateString: string }) {
    try {
      const date = new Date(params.dateString);
      const valid = !isNaN(date.getTime());

      return {
        success: true,
        valid,
        dateString: params.dateString,
        ...(valid && { timestamp: date.getTime(), iso: date.toISOString() }),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get relative time (e.g., "2 hours ago", "in 3 days")
   * @param timestamp Timestamp in milliseconds or ISO string
   * @param locale Locale for formatting (default: en-US)
   */
  async relative(params: { timestamp: number | string; locale?: string }) {
    try {
      const date = new Date(params.timestamp);
      const locale = params.locale || 'en-US';

      if (isNaN(date.getTime())) {
        return { success: false, error: 'Invalid timestamp' };
      }

      const now = Date.now();
      const diffMs = date.getTime() - now;
      const diffSec = Math.abs(diffMs) / 1000;

      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

      let value: number;
      let unit: Intl.RelativeTimeFormatUnit;

      if (diffSec < 60) {
        value = Math.round(diffMs / 1000);
        unit = 'second';
      } else if (diffSec < 3600) {
        value = Math.round(diffMs / (1000 * 60));
        unit = 'minute';
      } else if (diffSec < 86400) {
        value = Math.round(diffMs / (1000 * 60 * 60));
        unit = 'hour';
      } else if (diffSec < 604800) {
        value = Math.round(diffMs / (1000 * 60 * 60 * 24));
        unit = 'day';
      } else if (diffSec < 2592000) {
        value = Math.round(diffMs / (1000 * 60 * 60 * 24 * 7));
        unit = 'week';
      } else if (diffSec < 31536000) {
        value = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30));
        unit = 'month';
      } else {
        value = Math.round(diffMs / (1000 * 60 * 60 * 24 * 365));
        unit = 'year';
      }

      const relative = rtf.format(value, unit);

      return {
        success: true,
        relative,
        timestamp: date.getTime(),
        iso: date.toISOString(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get Unix timestamp (seconds since epoch)
   * @param timestamp Timestamp in milliseconds or ISO string (default: now)
   */
  async unix(params: { timestamp?: number | string }) {
    try {
      const date = params.timestamp ? new Date(params.timestamp) : new Date();

      if (isNaN(date.getTime())) {
        return { success: false, error: 'Invalid timestamp' };
      }

      return {
        success: true,
        unix: Math.floor(date.getTime() / 1000),
        iso: date.toISOString(),
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
