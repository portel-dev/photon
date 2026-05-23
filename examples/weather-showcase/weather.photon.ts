/**
 * Weather
 *
 * A tiny concept demo: one TypeScript class becomes a CLI command, a Beam UI,
 * an MCP tool, and an embedded chat-client app surface.
 *
 * @ui weather-card
 * @icon cloud-sun
 */
export default class Weather {
  private readonly cities: Record<string, WeatherSnapshot> = {
    london: {
      city: 'London',
      condition: 'Light rain',
      temperatureC: 14,
      feelsLikeC: 12,
      humidity: 78,
      windKph: 18,
      summary: 'A soft drizzle with bright breaks after lunch.',
      updatedAt: '2026-05-23T09:30:00Z',
      forecast: [
        { day: 'Today', condition: 'Light rain', highC: 16, lowC: 11, rainChance: 72 },
        { day: 'Tomorrow', condition: 'Partly cloudy', highC: 18, lowC: 10, rainChance: 24 },
        { day: 'Monday', condition: 'Sunny intervals', highC: 19, lowC: 12, rainChance: 18 },
      ],
    },
    singapore: {
      city: 'Singapore',
      condition: 'Thunderstorms',
      temperatureC: 31,
      feelsLikeC: 36,
      humidity: 84,
      windKph: 9,
      summary: 'Warm and humid with a late-afternoon storm window.',
      updatedAt: '2026-05-23T17:30:00+08:00',
      forecast: [
        { day: 'Today', condition: 'Thunderstorms', highC: 32, lowC: 27, rainChance: 86 },
        { day: 'Tomorrow', condition: 'Humid clouds', highC: 33, lowC: 27, rainChance: 58 },
        { day: 'Monday', condition: 'Scattered storms', highC: 32, lowC: 26, rainChance: 63 },
      ],
    },
    'san francisco': {
      city: 'San Francisco',
      condition: 'Coastal fog',
      temperatureC: 17,
      feelsLikeC: 16,
      humidity: 68,
      windKph: 21,
      summary: 'Morning fog clearing into a cool, bright afternoon.',
      updatedAt: '2026-05-23T02:30:00-07:00',
      forecast: [
        { day: 'Today', condition: 'Coastal fog', highC: 19, lowC: 12, rainChance: 8 },
        { day: 'Tomorrow', condition: 'Clear', highC: 21, lowC: 13, rainChance: 4 },
        { day: 'Monday', condition: 'Breezy sun', highC: 20, lowC: 12, rainChance: 6 },
      ],
    },
  };

  /**
   * Show a polished weather card for a city.
   *
   * Weather is intentionally simple here. The interesting part is that the same
   * method becomes a CLI command, Beam form, MCP tool, and embedded app UI.
   *
   * @param city City name {@example Singapore} {@choice Singapore,London,San Francisco}
   * @format card
   * @readOnly
   * @ui weather-card
   */
  current(params: { city: string }) {
    const key = params.city.trim().toLowerCase();
    const weather = this.cities[key];

    if (!weather) {
      throw new Error(
        `Try one of: ${Object.values(this.cities)
          .map((c) => c.city)
          .join(', ')}`
      );
    }

    return {
      ...weather,
      unit: 'celsius',
      generatedBy: 'examples/weather-showcase/weather.photon.ts',
    };
  }

  /**
   * List every built-in demo city.
   *
   * @format table
   * @readOnly
   */
  cities() {
    return Object.values(this.cities).map((city) => ({
      city: city.city,
      condition: city.condition,
      temp: `${city.temperatureC} C`,
      rain: `${city.forecast[0]?.rainChance ?? 0}%`,
    }));
  }
}

interface WeatherSnapshot {
  city: string;
  condition: string;
  temperatureC: number;
  feelsLikeC: number;
  humidity: number;
  windKph: number;
  summary: string;
  updatedAt: string;
  forecast: WeatherDay[];
}

interface WeatherDay {
  day: string;
  condition: string;
  highC: number;
  lowC: number;
  rainChance: number;
}
