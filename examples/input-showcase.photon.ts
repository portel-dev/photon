/**
 * Input Showcase
 *
 * Demonstrates all input format types in the Photon auto-UI.
 * Each method showcases a different input widget.
 *
 * @version 1.0.0
 * @icon 🎛️
 */
export default class InputShowcase {
  /**
   * Basic text input (default)
   * @param name Your full name
   */
  text({ name }: { name: string }) {
    return { received: name, format: 'text (default)' };
  }

  /**
   * Email input with validation
   * @param email Your email address {@format email}
   */
  email({ email }: { email: string }) {
    return { received: email, format: 'email', valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) };
  }

  /**
   * Password input with show/hide toggle
   * @param password Your secret {@format password}
   */
  secret({ password }: { password: string }) {
    return { received: '•'.repeat(password.length), length: password.length, format: 'password' };
  }

  /**
   * URL input with open-link button
   * @param url Website URL {@format url}
   */
  website({ url }: { url: string }) {
    return { received: url, format: 'url' };
  }

  /**
   * Phone number input
   * @param phone Contact number {@format phone}
   */
  phone({ phone }: { phone: string }) {
    return { received: phone, format: 'phone/tel' };
  }

  /**
   * Color picker with hex input
   * @param color Theme color {@format color}
   */
  color({ color }: { color: string }) {
    return { received: color, format: 'color', preview: `██ ${color}` };
  }

  /**
   * Search input
   * @param query Search term {@format search}
   */
  search({ query }: { query: string }) {
    return { received: query, format: 'search' };
  }

  /**
   * Date picker with calendar
   * @param date Select a date {@format date}
   */
  date({ date }: { date: string }) {
    const d = new Date(date);
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      d.getDay()
    ];
    return { received: date, dayOfWeek: dayName, format: 'date' };
  }

  /**
   * Smart date: birthday opens year view ~25 years ago
   * @param birthday Your date of birth {@format date}
   */
  birthday({ birthday }: { birthday: string }) {
    const age = Math.floor((Date.now() - new Date(birthday).getTime()) / 31557600000);
    return { received: birthday, age, format: 'date (smart: birthday)' };
  }

  /**
   * Date-time picker with calendar + time
   * @param datetime Event date and time {@format date-time}
   */
  datetime({ datetime }: { datetime: string }) {
    return { received: datetime, format: 'date-time' };
  }

  /**
   * Date range with two date pickers
   * @param range Period {@format date-range}
   */
  daterange({ range }: { range: { start: string; end: string } }) {
    const days = Math.round(
      (new Date(range.end).getTime() - new Date(range.start).getTime()) / 86400000
    );
    return { start: range.start, end: range.end, days, format: 'date-range' };
  }

  /**
   * Tag/chip input
   * @param tags Labels for the item {@format tags}
   */
  tags({ tags }: { tags: string[] }) {
    return { received: tags, count: tags.length, format: 'tags' };
  }

  /**
   * Star rating (1-5)
   * @param rating Your rating {@format rating}
   */
  rate({ rating }: { rating: number }) {
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    return { received: rating, stars, format: 'rating' };
  }

  /**
   * Segmented control for enum
   * @param size T-shirt size {@format segmented}
   */
  segment({ size }: { size: 'xs' | 's' | 'm' | 'l' | 'xl' }) {
    return { received: size, format: 'segmented' };
  }

  /**
   * Radio buttons for enum
   * @param priority Task priority {@format radio}
   */
  radio({ priority }: { priority: 'low' | 'medium' | 'high' | 'critical' }) {
    return { received: priority, format: 'radio' };
  }

  /**
   * Code editor with line numbers
   * @param code TypeScript snippet {@format code:typescript}
   */
  code({ code }: { code: string }) {
    const lines = code.split('\n').length;
    return { lines, chars: code.length, format: 'code:typescript', preview: code.slice(0, 100) };
  }

  /**
   * Markdown editor with live preview
   * @param notes Write some notes {@format markdown}
   */
  markdown({ notes }: { notes: string }) {
    const words = notes.trim().split(/\s+/).length;
    return { words, chars: notes.length, format: 'markdown', preview: notes.slice(0, 100) };
  }

  /**
   * Slider (number with min + max)
   * @param volume Volume level {@min 0} {@max 100}
   */
  slider({ volume }: { volume: number }) {
    const bar = '█'.repeat(Math.round(volume / 5)) + '░'.repeat(20 - Math.round(volume / 5));
    return { received: volume, bar, format: 'slider (auto from min+max)' };
  }

  /**
   * Boolean toggle
   * @param enabled Feature flag
   */
  toggle({ enabled }: { enabled: boolean }) {
    return { received: enabled, format: 'boolean toggle' };
  }

  /**
   * Enum dropdown (default for enums)
   * @param country Select country
   */
  dropdown({ country }: { country: 'us' | 'uk' | 'ca' | 'au' | 'de' | 'fr' | 'jp' | 'in' }) {
    return { received: country, format: 'enum dropdown (default)' };
  }

  /**
   * File picker
   * @param file Select a file {@format file}
   */
  filepick({ file }: { file: string }) {
    return { received: file, format: 'file picker' };
  }

  /**
   * Textarea (auto-detected from key name)
   * @param content Your content
   */
  textarea({ content }: { content: string }) {
    return {
      received: content.slice(0, 100),
      length: content.length,
      format: 'textarea (auto from key name)',
    };
  }
}
