/**
 * Standalone format renderers for custom UI iframes.
 *
 * Served as `/api/photon-renderers.js` and lazy-loaded by `photon.render()`.
 * Pure vanilla JS — no framework dependencies. Mirrors the auto UI's
 * @format rendering but as imperative functions.
 *
 * Usage inside custom UI:
 *   photon.render(container, data, 'chart:bar')
 *   photon.render(container, data, 'table')
 *   photon.render(container, data, 'gauge', { min: 0, max: 100 })
 */

export function generateRenderersScript(): string {
  // This is generated as a self-contained JS module that registers
  // window._photonRenderers with all format renderer functions
  return `(function() {
  'use strict';

  // ── Theme helpers ──

  // Read colors dynamically from CSS custom properties so theme changes are reflected.
  // Falls back to sensible defaults if vars aren't set.
  function getColors() {
    var root = getComputedStyle(document.documentElement);
    var get = function(prop, fallback) { return root.getPropertyValue(prop).trim() || fallback; };
    var isDark = (document.documentElement.getAttribute('data-theme') || 'dark') !== 'light';
    return {
      text: get('--text', isDark ? '#e0e0e0' : '#1a1a1a'),
      textMuted: get('--muted', isDark ? '#888' : '#666'),
      bg: get('--bg', isDark ? '#1a1a1a' : '#ffffff'),
      bgAlt: get('--bg-tertiary', isDark ? '#242424' : '#f5f5f5'),
      border: get('--border', isDark ? '#333' : '#e0e0e0'),
      accent: get('--accent', isDark ? '#6c9eff' : '#2563eb'),
      palette: isDark
        ? ['#6c9eff','#34d399','#fbbf24','#f87171','#a78bfa','#fb923c','#38bdf8','#e879f9']
        : ['#2563eb','#059669','#d97706','#dc2626','#7c3aed','#ea580c','#0284c7','#c026d3']
    };
  }
  var colors = getColors();

  // Shared semantic color map — used by badge, banner, ring, alert, sparkline, etc.
  var VARIANT_COLORS = {
    success: '#34d399',
    error: '#f87171',
    warning: '#fbbf24',
    destructive: '#f87171',
    info: colors.accent,
    neutral: colors.textMuted
  };

  // Factory for lazy-loading CDN scripts with queued callbacks
  function _makeLoader(url, cssUrl) {
    var loading = false, loaded = false, queue = [];
    return function(cb) {
      if (loaded) { cb(); return; }
      queue.push(cb);
      if (loading) return;
      loading = true;
      if (cssUrl) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl;
        document.head.appendChild(link);
      }
      var s = document.createElement('script');
      s.src = url;
      s.onload = function() { loaded = true; queue.forEach(function(fn) { fn(); }); queue = []; };
      s.onerror = function() { queue.forEach(function(fn) { fn(); }); queue = []; };
      document.head.appendChild(s);
    };
  }

  function esc(s) {
    if (typeof s !== 'string') return String(s == null ? '' : s);
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatLabel(key) {
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .replace(/\\b(id|url|api|ui|ip|cpu|gpu|ram|dns|ssl|http|ssh|sql)\\b/gi, function(m) { return m.toUpperCase(); })
      .replace(/^./, function(c) { return c.toUpperCase(); });
  }

  function formatValue(v) {
    if (v == null) return '\\u2014';
    if (typeof v === 'boolean') return v ? '\\u2713' : '\\u2717';
    if (typeof v === 'number') {
      if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
      if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return v.toLocaleString();
    }
    if (typeof v === 'string' && /^https?:\\/\\//.test(v)) return '<a href="' + esc(v) + '" target="_blank" style="color:' + colors.accent + '">' + esc(v.length > 40 ? v.slice(0, 37) + '...' : v) + '</a>';
    if (typeof v === 'object') return '<code style="font-size:11px;">' + esc(JSON.stringify(v)) + '</code>';
    return esc(v);
  }

  // ── Renderers ──

  var renderers = {};

  // ─── Table ───
  renderers.table = function(container, data, opts) {
    opts = opts || {};
    var rows = Array.isArray(data) ? data : [data];
    if (!rows.length) { container.innerHTML = '<p style="color:' + colors.textMuted + '">No data</p>'; return; }
    var cols = Object.keys(rows[0]).filter(function(k) { return typeof rows[0][k] !== 'function'; });
    if (opts.columns) cols = opts.columns;

    var sortCol = null, sortDir = 1;
    function render() {
      var sorted = rows.slice();
      if (sortCol !== null) {
        sorted.sort(function(a, b) {
          var va = a[sortCol], vb = b[sortCol];
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
          return String(va || '').localeCompare(String(vb || '')) * sortDir;
        });
      }
      var h = '<table style="width:100%;border-collapse:collapse;font-size:13px;color:' + colors.text + '">';
      h += '<thead><tr>';
      for (var i = 0; i < cols.length; i++) {
        var arrow = sortCol === cols[i] ? (sortDir === 1 ? ' \\u25b2' : ' \\u25bc') : '';
        h += '<th data-col="' + esc(cols[i]) + '" style="cursor:pointer;text-align:left;padding:8px 10px;border-bottom:2px solid ' + colors.border + ';font-weight:600;white-space:nowrap;color:' + colors.textMuted + ';font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">' + esc(formatLabel(cols[i])) + arrow + '</th>';
      }
      h += '</tr></thead><tbody>';
      for (var r = 0; r < sorted.length; r++) {
        var bgRow = r % 2 === 0 ? colors.bg : colors.bgAlt;
        h += '<tr style="background:' + bgRow + '">';
        for (var c = 0; c < cols.length; c++) {
          h += '<td style="padding:6px 10px;border-bottom:1px solid ' + colors.border + '">' + formatValue(sorted[r][cols[c]]) + '</td>';
        }
        h += '</tr>';
      }
      h += '</tbody></table>';
      container.innerHTML = h;
      container.querySelectorAll('th[data-col]').forEach(function(th) {
        th.onclick = function() {
          var col = th.getAttribute('data-col');
          if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = 1; }
          render();
        };
      });
    }
    render();
  };

  // ─── Gauge ───
  renderers.gauge = function(container, data, opts) {
    opts = opts || {};
    var value = typeof data === 'number' ? data : (data.value || data.current || data.count || 0);
    var min = opts.min != null ? opts.min : (data.min || 0);
    var max = opts.max != null ? opts.max : (data.max || 100);
    var label = opts.label || data.label || data.title || data.name || '';
    var unit = opts.unit || data.unit || '';

    var norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
    var cx = 80, cy = 80, r = 60;

    // SVG arc helper: point on upper semicircle at angle (degrees, 0°=right, 180°=left)
    // Uses cy - r*sin to place points ABOVE center (SVG Y-axis points down)
    function arcPoint(angleDeg) {
      var rad = angleDeg * Math.PI / 180;
      return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
    }

    // Gauge spans upper semicircle: left (180°) → top (90°) → right (0°)
    // Value arc ends at this angle (180° = empty, 0° = full)
    var valueAngleDeg = 180 - norm * 180;
    var ep = arcPoint(valueAngleDeg);
    var large = 0; // value arc is at most 180° (full semicircle), never the SVG "large arc"

    // Green → Yellow → Red
    function gaugeColor(n) {
      var rr, gg, bb;
      if (n < 0.5) { var t = n * 2; rr = Math.round(34 + t * (251 - 34)); gg = Math.round(211 - t * (211 - 191)); bb = Math.round(153 - t * (153 - 36)); }
      else { var t2 = (n - 0.5) * 2; rr = Math.round(251 + t2 * (248 - 251)); gg = Math.round(191 - t2 * (191 - 113)); bb = Math.round(36 - t2 * (36 - 113)); }
      return 'rgb(' + rr + ',' + gg + ',' + bb + ')';
    }

    var color = gaugeColor(norm);
    var display = typeof value === 'number' ? formatValue(value) : value;
    container.innerHTML = '<div style="text-align:center">' +
      '<svg viewBox="0 0 160 100" width="200" style="display:block;margin:0 auto">' +
      '<path d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 1 1 ' + (cx + r) + ' ' + cy + '" fill="none" stroke="' + colors.border + '" stroke-width="12" stroke-linecap="round"/>' +
      (norm > 0.001 ? '<path d="M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + ep[0] + ' ' + ep[1] + '" fill="none" stroke="' + color + '" stroke-width="12" stroke-linecap="round"/>' : '') +
      '<text x="' + cx + '" y="' + (cy - 10) + '" text-anchor="middle" fill="' + colors.text + '" font-size="22" font-weight="700">' + esc(display) + (unit ? '<tspan font-size="12">' + esc(unit) + '</tspan>' : '') + '</text>' +
      (label ? '<text x="' + cx + '" y="' + (cy + 5) + '" text-anchor="middle" fill="' + colors.textMuted + '" font-size="11">' + esc(label) + '</text>' : '') +
      '</svg></div>';
  };

  // ─── Metric ───
  renderers.metric = function(container, data, opts) {
    opts = opts || {};
    var value = data.value || data.count || data.total || data.current || 0;
    var label = opts.label || data.label || data.name || data.title || '';
    var delta = data.delta || data.change || data.diff;
    var trend = data.trend || (typeof delta === 'number' ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat') : null);
    var display = typeof value === 'number' ? formatValue(value) : esc(value);
    var trendHtml = '';
    if (trend) {
      var arrow = trend === 'up' ? '\\u2191' : trend === 'down' ? '\\u2193' : '\\u2192';
      var trendColor = trend === 'up' ? '#34d399' : trend === 'down' ? '#f87171' : colors.textMuted;
      trendHtml = '<span style="font-size:14px;color:' + trendColor + ';margin-left:8px">' + arrow + (delta != null ? ' ' + (delta > 0 ? '+' : '') + formatValue(delta) : '') + '</span>';
    }
    container.innerHTML = '<div style="text-align:center;padding:16px">' +
      '<div style="font-size:36px;font-weight:700;color:' + colors.text + '">' + display + trendHtml + '</div>' +
      (label ? '<div style="font-size:13px;color:' + colors.textMuted + ';margin-top:4px">' + esc(label) + '</div>' : '') +
      '</div>';
  };

  // ─── Progress ───
  renderers.progress = function(container, data, opts) {
    opts = opts || {};
    var value = typeof data === 'number' ? data : (data.value || data.progress || data.percent || 0);
    var max = opts.max != null ? opts.max : (data.max || 100);
    var pct = Math.max(0, Math.min(100, (value / max) * 100));
    var label = opts.label || data.label || '';
    var color = pct >= 80 ? '#34d399' : pct >= 50 ? '#fbbf24' : colors.accent;
    container.innerHTML = '<div style="padding:8px 0">' +
      (label ? '<div style="font-size:12px;color:' + colors.textMuted + ';margin-bottom:4px">' + esc(label) + '</div>' : '') +
      '<div style="background:' + colors.bgAlt + ';border-radius:6px;height:10px;overflow:hidden">' +
      '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:6px;transition:width 0.5s ease"></div>' +
      '</div>' +
      '<div style="font-size:11px;color:' + colors.textMuted + ';margin-top:2px;text-align:right">' + Math.round(pct) + '%</div>' +
      '</div>';
  };

  // ─── Timeline ───
  renderers.timeline = function(container, data, opts) {
    opts = opts || {};
    var items = Array.isArray(data) ? data : [data];
    var dateKey = opts.date || _findKey(items[0], ['date','time','createdAt','timestamp','at','when']);
    var titleKey = opts.title || _findKey(items[0], ['title','event','name','action','summary']);
    var descKey = opts.description || _findKey(items[0], ['description','details','message','body','text']);

    var h = '<div style="padding:4px 0">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var isLast = i === items.length - 1;
      h += '<div style="display:flex;gap:12px;min-height:48px">';
      // Dot + line
      h += '<div style="display:flex;flex-direction:column;align-items:center;width:16px">' +
        '<div style="width:10px;height:10px;border-radius:50%;background:' + colors.palette[i % colors.palette.length] + ';flex-shrink:0;margin-top:4px"></div>' +
        (isLast ? '' : '<div style="width:2px;flex:1;background:' + colors.border + ';margin:4px 0"></div>') +
        '</div>';
      // Content
      h += '<div style="flex:1;padding-bottom:' + (isLast ? '0' : '16') + 'px">';
      if (dateKey && item[dateKey]) h += '<div style="font-size:11px;color:' + colors.textMuted + '">' + esc(_formatDate(item[dateKey])) + '</div>';
      if (titleKey && item[titleKey]) h += '<div style="font-weight:600;color:' + colors.text + ';font-size:13px">' + esc(item[titleKey]) + '</div>';
      if (descKey && item[descKey]) h += '<div style="font-size:12px;color:' + colors.textMuted + ';margin-top:2px">' + esc(item[descKey]) + '</div>';
      h += '</div></div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Badge ───
  renderers.badge = function(container, data, opts) {
    opts = opts || {};
    var badgeColors = {
      success: { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
      error:   { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
      warning: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24' },
      info:    { bg: 'rgba(108,158,255,0.15)', text: '#6c9eff' },
      neutral: { bg: colors.bgAlt, text: colors.textMuted }
    };
    function renderOne(item) {
      var text = typeof item === 'string' ? item : (item.status || item.label || item.text || item.value || JSON.stringify(item));
      var variant = opts.variant || _badgeVariant(text);
      var c = badgeColors[variant] || badgeColors.neutral;
      var namePrefix = (typeof item === 'object' && item !== null && (item.name || item.title)) ? '<span style="font-size:12px;color:' + colors.textMuted + ';margin-right:4px">' + esc(item.name || item.title) + '</span>' : '';
      return namePrefix + '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:500;background:' + c.bg + ';color:' + c.text + '">' + esc(text) + '</span>';
    }
    if (Array.isArray(data)) {
      container.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' + data.map(renderOne).join('') + '</div>';
    } else {
      container.innerHTML = renderOne(data);
    }
  };

  // ─── List ───
  renderers.list = function(container, data, opts) {
    opts = opts || {};
    var items = Array.isArray(data) ? data : [data];
    var titleKey = opts.title || _findKey(items[0], ['title','name','label','subject']);
    var subtitleKey = opts.subtitle || _findKey(items[0], ['subtitle','description','email','detail']);
    var badgeKey = opts.badge || _findKey(items[0], ['status','badge','role','type','state']);

    var h = '<div style="display:flex;flex-direction:column;gap:1px">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (typeof item === 'string') { h += '<div style="padding:10px 12px;background:' + colors.bg + ';border-bottom:1px solid ' + colors.border + ';font-size:13px;color:' + colors.text + '">' + esc(item) + '</div>'; continue; }
      h += '<div style="padding:10px 12px;background:' + colors.bg + ';border-bottom:1px solid ' + colors.border + ';display:flex;align-items:center;justify-content:space-between">';
      h += '<div>';
      if (titleKey && item[titleKey]) h += '<div style="font-weight:500;color:' + colors.text + ';font-size:13px">' + esc(item[titleKey]) + '</div>';
      if (subtitleKey && item[subtitleKey]) h += '<div style="font-size:12px;color:' + colors.textMuted + ';margin-top:1px">' + esc(item[subtitleKey]) + '</div>';
      h += '</div>';
      if (badgeKey && item[badgeKey]) {
        var bc = _badgeVariant(item[badgeKey]);
        var bcColors = { success: '#34d399', error: '#f87171', warning: '#fbbf24', info: '#6c9eff', neutral: colors.textMuted };
        h += '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + (bc === 'neutral' ? colors.bgAlt : 'rgba(0,0,0,0.1)') + ';color:' + (bcColors[bc] || colors.textMuted) + '">' + esc(item[badgeKey]) + '</span>';
      }
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Chart (lazy-loads Chart.js) ───
  renderers['chart'] = renderers['chart:bar'] = renderers['chart:hbar'] = renderers['chart:line'] = renderers['chart:pie'] = renderers['chart:area'] = renderers['chart:donut'] = renderers['chart:radar'] = function(container, data, opts, formatKey) {
    opts = opts || {};
    var items = Array.isArray(data) ? data : (data.data || data.items || data.rows || [data]);
    if (!items.length || typeof items[0] !== 'object') { container.innerHTML = '<p style="color:' + colors.textMuted + '">No chart data</p>'; return; }

    // Detect fields
    var keys = Object.keys(items[0]);
    var numericKeys = keys.filter(function(k) { return typeof items[0][k] === 'number'; });
    var stringKeys = keys.filter(function(k) { return typeof items[0][k] === 'string'; });
    var labelKey = opts.label || opts.x || stringKeys[0] || keys[0];
    var valueKeys = opts.value ? [opts.value] : (opts.y ? [opts.y] : numericKeys);
    if (!valueKeys.length) { container.innerHTML = '<p style="color:' + colors.textMuted + '">No numeric fields for chart</p>'; return; }

    // Determine chart type from format key
    var chartType = 'bar';
    if (formatKey) {
      var parts = formatKey.split(':');
      if (parts[1]) chartType = parts[1];
    }
    var isHorizontal = chartType === 'hbar';
    if (isHorizontal) chartType = 'bar'; // hbar = bar with indexAxis: 'y'
    if (chartType === 'donut') chartType = 'doughnut';
    if (chartType === 'area') chartType = 'line'; // area = line with fill

    // Auto-detect: time series → line, few items → pie
    if (chartType === 'bar' && !formatKey) {
      var isTime = /date|time|day|month|year|week/i.test(labelKey);
      if (isTime) chartType = 'line';
      else if (items.length <= 8 && valueKeys.length === 1) chartType = 'pie';
    }

    var canvasId = '_pc' + Math.random().toString(36).slice(2, 8);
    container.innerHTML = '<div style="position:relative;width:100%;max-height:360px"><canvas id="' + canvasId + '"></canvas></div>';

    _loadChartJS(function() {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;

      var labels = items.map(function(r) { return r[labelKey]; });
      var datasets = valueKeys.map(function(vk, di) {
        var c = colors.palette[di % colors.palette.length];
        return {
          label: formatLabel(vk),
          data: items.map(function(r) { return r[vk]; }),
          backgroundColor: (chartType === 'pie' || chartType === 'doughnut') ? colors.palette.slice(0, items.length) : c + '80',
          borderColor: c,
          borderWidth: chartType === 'line' ? 2 : 1,
          fill: formatKey === 'chart:area',
          tension: 0.3
        };
      });

      // Force high-DPI rendering: use at least 2x pixel ratio so charts
      // stay crisp inside transform:scale() slide canvases on retina displays.
      var dpr = Math.max(window.devicePixelRatio || 1, 2);
      new Chart(canvas, {
        type: chartType,
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          devicePixelRatio: dpr,
          indexAxis: isHorizontal ? 'y' : 'x',
          plugins: { legend: { labels: { color: colors.textMuted } } },
          scales: (chartType === 'pie' || chartType === 'doughnut') ? {} : {
            x: { ticks: { color: colors.textMuted }, grid: { color: colors.border + '40' } },
            y: { ticks: { color: colors.textMuted }, grid: { color: colors.border + '40' } }
          }
        }
      });
    });
  };

  // ─── Markdown ───
  renderers.markdown = function(container, data) {
    var text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    // Basic markdown: headings, bold, italic, code, links, lists
    var html = esc(text)
      .replace(/^### (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:12px 0 4px;color:' + colors.text + '">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="font-size:17px;font-weight:600;margin:14px 0 6px;color:' + colors.text + '">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="font-size:20px;font-weight:700;margin:16px 0 8px;color:' + colors.text + '">$1</h1>')
      .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
      .replace(/\\\x60(.+?)\\\x60/g, '<code style="background:' + colors.bgAlt + ';padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
      .replace(/^- (.+)$/gm, '<li style="margin:2px 0;margin-left:16px;color:' + colors.text + '">$1</li>')
      .replace(/\\n/g, '<br>');
    container.innerHTML = '<div style="font-size:13px;line-height:1.6;color:' + colors.text + '">' + html + '</div>';
  };

  // ─── JSON ───
  renderers.json = function(container, data) {
    var text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    container.innerHTML = '<pre style="font-size:12px;line-height:1.5;color:' + colors.text + ';background:' + colors.bgAlt + ';padding:12px;border-radius:6px;overflow:auto;max-height:400px;margin:0">' + esc(text) + '</pre>';
  };

  // ─── A2UI v0.9 ───
  // Renders Google A2UI v0.9 "Basic catalog" surfaces. Accepts either:
  //   (a) a v0.9 JSONL message array (createSurface/updateComponents/updateDataModel)
  //   (b) a raw method result, auto-mapped via the same heuristics as src/a2ui/mapper.ts
  // Kept inline (no external runtime) so it stays consistent with the other
  // @format renderers served from /api/photon-renderers.js.
  renderers.a2ui = function(container, data) {
    // ── 1. Normalize input to { components, dataModel } ──
    var surface = a2uiExtractSurface(data) || a2uiMapResult(data);
    var byId = {};
    (surface.components || []).forEach(function(c) { byId[c.id] = c; });
    if (!byId.root) {
      container.innerHTML = '<pre style="color:' + colors.text + ';background:' + colors.bgAlt + ';padding:12px;border-radius:6px;margin:0">A2UI error: missing root component</pre>';
      return;
    }
    // ── 2. Render from root ──
    var html = '<div class="a2ui-surface" style="color:' + colors.text + ';font-size:14px;line-height:1.5">'
      + a2uiRender('root', byId, surface.data, null)
      + '</div>';
    container.innerHTML = html;

    // ── 3. Local data-model snapshot. Starts as a clone of the data the
    // server seeded the surface with, then absorbs every TextField edit so
    // the snapshot the action carries reflects current user input.
    var localData = a2uiCloneData(surface.data);
    container.querySelectorAll('input[data-a2ui-input]').forEach(function(input) {
      input.addEventListener('input', function() {
        var ptr = input.getAttribute('data-a2ui-input') || '';
        a2uiSetByPath(localData, ptr, input.value);
      });
    });

    // ── 4. Button clicks dispatch a bubbling CustomEvent. The host (Beam
    // result-viewer) catches it and routes to <photon>/<actionName>. If
    // nothing handles it (preventDefault), fall back to a toast so the
    // renderer is still useful in standalone iframes.
    container.querySelectorAll('[data-a2ui-action]').forEach(function(btn) {
      btn.addEventListener('click', function(ev) {
        ev.preventDefault();
        var name = btn.getAttribute('data-a2ui-action') || '';
        var detail = { name: name, context: localData, surfaceId: surface.surfaceId || null };
        var dispatched = container.dispatchEvent(new CustomEvent('a2ui:action', {
          detail: detail,
          bubbles: true,
          composed: true,
          cancelable: true
        }));
        if (dispatched) {
          // No host caught it — show the toast so dev still sees the click
          a2uiToast(container, 'A2UI action: ' + name);
        }
      });
    });
  };

  // Cheap structured clone — covers what the mapper produces (plain objects,
  // arrays, primitives). Avoids structuredClone() so we don't depend on a
  // newer DOM API in iframe contexts that might not have it.
  function a2uiCloneData(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(a2uiCloneData);
    var out = {};
    for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = a2uiCloneData(value[k]);
    return out;
  }

  // Mirror of looksLikeA2UIStream in src/a2ui/mapper.ts — keep the Beam
  // renderer consistent with CLI/AG-UI. Requires: non-empty array whose
  // elements all have (version:string) + exactly one wrapper key whose
  // value is an object with a string surfaceId. Without this guard, row
  // data that happens to include an updateDataModel column is silently
  // treated as a pre-built A2UI stream and renders empty in Beam.
  function a2uiLooksLikeStream(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    var wrapperKeys = ['createSurface','updateComponents','updateDataModel','deleteSurface'];
    for (var i = 0; i < arr.length; i++) {
      var m = arr[i];
      if (!m || typeof m !== 'object') return false;
      if (typeof m.version !== 'string') return false;
      var count = 0;
      for (var k = 0; k < wrapperKeys.length; k++) {
        var key = wrapperKeys[k];
        if (!(key in m)) continue;
        count++;
        var wrapped = m[key];
        if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) return false;
        if (typeof wrapped.surfaceId !== 'string') return false;
      }
      if (count !== 1) return false;
    }
    return true;
  }

  // Extract {components, data} from a v0.9 JSONL message array if the caller
  // passed one (e.g. the AG-UI CUSTOM event stream replayed as data).
  function a2uiExtractSurface(data) {
    if (!a2uiLooksLikeStream(data)) return null;
    var components = null;
    var dataModel = {};
    var surfaceId = null;
    for (var i = 0; i < data.length; i++) {
      var m = data[i];
      if (!m || typeof m !== 'object') continue;
      if (m.createSurface && m.createSurface.surfaceId) {
        surfaceId = m.createSurface.surfaceId;
      }
      if (m.updateComponents && m.updateComponents.components) {
        components = m.updateComponents.components;
      } else if (m.updateDataModel) {
        var path = m.updateDataModel.path || '/';
        if (path === '/' || path === '') {
          dataModel = m.updateDataModel.value;
        } else {
          a2uiSetByPath(dataModel, path, m.updateDataModel.value);
        }
      }
    }
    return components ? { components: components, data: dataModel, surfaceId: surfaceId } : null;
  }

  // Client-side mapper — mirrors src/a2ui/mapper.ts heuristics. Kept in sync
  // by intent; see tests/a2ui-mapper.test.ts for the contract.
  function a2uiMapResult(result) {
    if (result && typeof result === 'object' && result.__a2ui === true && Array.isArray(result.components)) {
      return { components: result.components, data: result.data || {} };
    }
    if (result == null || result === '') {
      return { components: [{id:'root', component:'Text', text:''}], data: { value: '' } };
    }
    if (typeof result !== 'object') {
      return { components: [{id:'root', component:'Text', text: String(result)}], data: { value: String(result) } };
    }
    if (Array.isArray(result)) {
      if (result.length === 0) {
        return { components: [{id:'root', component:'Text', text:'(empty list)'}], data: { value:'(empty list)' } };
      }
      var first = result[0];
      if (first == null || typeof first !== 'object' || Array.isArray(first)) {
        var items = result.map(function(v, i) { return { label: String(v), index: i }; });
        return {
          components: [
            {id:'root', component:'List', list:{template:{id:'rowCard'}, data:{path:'/items'}}},
            {id:'rowCard', component:'Card', child:'rowText'},
            {id:'rowText', component:'Text', text:{path:'label'}}
          ],
          data: { items: items }
        };
      }
      var keys = Object.keys(first);
      var titleKey = ['title','name','label','subject'].filter(function(k){return keys.indexOf(k)>=0;})[0] || keys[0] || 'value';
      return {
        components: [
          {id:'root', component:'List', list:{template:{id:'rowCard'}, data:{path:'/items'}}},
          {id:'rowCard', component:'Card', child:'rowText'},
          {id:'rowText', component:'Text', text:{path:titleKey}}
        ],
        data: { items: result }
      };
    }
    // Card-shaped: {title, description?, actions?}. Must mirror the server
    // mapper's stricter rule (src/a2ui/mapper.ts): the object's keys have to
    // be a subset of {title, description, actions}. Otherwise a result with
    // a title plus non-card fields would render as a Card on the Beam
    // preview while CLI/AG-UI render a key/value column, and the non-title
    // fields would silently disappear in Beam.
    var cardKeys = ['title','description','actions'];
    var isCardShape = typeof result.title === 'string'
      && (result.actions === undefined || Array.isArray(result.actions))
      && Object.keys(result).every(function(k) { return cardKeys.indexOf(k) !== -1; });
    if (isCardShape) {
      var contentIds = ['cardTitle'];
      var cardComponents = [
        {id:'root', component:'Card', child:'cardBody'},
        {id:'cardTitle', component:'Text', text:{path:'/title'}, variant:'h2'}
      ];
      if (result.description) {
        cardComponents.push({id:'cardDesc', component:'Text', text:{path:'/description'}});
        contentIds.push('cardDesc');
      }
      (result.actions || []).forEach(function(a, i) {
        var btnId = 'cardBtn' + i;
        cardComponents.push({id: btnId, component:'Button', text: a.label, variant: i===0 ? 'primary' : 'borderless', action: {event:{name: a.name || a.label}}});
        contentIds.push(btnId);
      });
      cardComponents.push({id:'cardBody', component:'Column', children: contentIds});
      return { components: cardComponents, data: result };
    }
    // Plain object → Column of markdown-style key rows
    var objKeys = Object.keys(result);
    if (objKeys.length === 0) {
      return { components: [{id:'root', component:'Text', text:'(empty object)'}], data: { value:'(empty object)' } };
    }
    var childIds = [];
    var objComponents = [];
    objKeys.forEach(function(k, i) {
      var rowId = 'row' + i;
      objComponents.push({id: rowId, component:'Text', text: {call:'formatString', args:{value:'**'+k+':** \${/'+k+'}'}}});
      childIds.push(rowId);
    });
    objComponents.unshift({id:'root', component:'Column', children: childIds});
    return { components: objComponents, data: result };
  }

  // JSON Pointer (RFC 6901) resolve, with a "relative" fallback used inside
  // List template scopes. Leading '/' ⇒ absolute; anything else ⇒ resolved
  // against the current scope (current list item).
  function a2uiResolvePath(dataModel, ptr, scope) {
    if (!ptr && ptr !== '') return undefined;
    var absolute = typeof ptr === 'string' && ptr.indexOf('/') === 0;
    var parts = absolute ? ptr.slice(1).split('/') : String(ptr).split('/');
    var cur = absolute ? dataModel : (scope != null ? scope : dataModel);
    for (var i = 0; i < parts.length; i++) {
      var key = parts[i];
      if (key === '') continue;
      if (cur == null) return undefined;
      // RFC 6901 escape unescape
      key = key.replace(/~1/g, '/').replace(/~0/g, '~');
      cur = cur[key];
    }
    return cur;
  }

  function a2uiSetByPath(root, ptr, value) {
    var parts = ptr.replace(/^\\//,'').split('/').filter(Boolean);
    if (parts.length === 0) return;
    var cur = root;
    for (var i = 0; i < parts.length - 1; i++) {
      // RFC 6901: decode ~1 -> "/" and ~0 -> "~" (in that order, ~1 first).
      // a2uiResolvePath decodes these — the write path must match or keys
      // with slashes in their name land under the wrong property.
      var k = parts[i].replace(/~1/g, '/').replace(/~0/g, '~');
      if (typeof cur[k] !== 'object' || cur[k] == null) cur[k] = {};
      cur = cur[k];
    }
    var last = parts[parts.length - 1].replace(/~1/g, '/').replace(/~0/g, '~');
    cur[last] = value;
  }

  // DynamicString / DynamicNumber / DynamicBoolean resolver: literal | {path} | {call: formatString, ...}
  function a2uiResolveDynamic(v, dataModel, scope) {
    if (v == null) return '';
    if (typeof v !== 'object') return v;
    if ('path' in v) return a2uiResolvePath(dataModel, v.path, scope);
    if ('call' in v && v.call === 'formatString') {
      var tpl = String((v.args && v.args.value) || '');
      return tpl.replace(/\\\$\\\{([^}]+)\\\}/g, function(_, p) {
        var val = a2uiResolvePath(dataModel, p, scope);
        return val == null ? '' : String(val);
      });
    }
    return '';
  }

  // Minimal markdown: **bold**, *italic*, \`code\` — safe because esc() ran first.
  function a2uiLightMarkdown(str) {
    return String(str)
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*([^*]+)\\*/g, '<em>$1</em>')
      .replace(/\`([^\`]+)\`/g, '<code style="background:' + colors.bgAlt + ';padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
  }

  // Render a component by id. Recursive.
  function a2uiRender(id, byId, dataModel, scope) {
    var c = byId[id];
    if (!c) return '<span style="color:' + colors.textMuted + ';font-size:12px">[missing: ' + esc(String(id)) + ']</span>';
    var kind = c.component;
    switch (kind) {
      case 'Text': {
        var text = a2uiResolveDynamic(c.text, dataModel, scope);
        var safe = esc(String(text == null ? '' : text));
        var rendered = a2uiLightMarkdown(safe);
        var v = c.variant || '';
        if (v === 'h1') return '<h1 style="font-size:22px;font-weight:700;margin:0 0 8px;color:' + colors.text + '">' + rendered + '</h1>';
        if (v === 'h2') return '<h2 style="font-size:18px;font-weight:600;margin:0 0 6px;color:' + colors.text + '">' + rendered + '</h2>';
        if (v === 'h3') return '<h3 style="font-size:15px;font-weight:600;margin:0 0 4px;color:' + colors.text + '">' + rendered + '</h3>';
        if (v === 'caption') return '<span style="font-size:12px;color:' + colors.textMuted + '">' + rendered + '</span>';
        return '<div style="margin:2px 0">' + rendered + '</div>';
      }
      case 'Column': {
        var colKids = (c.children || []).map(function(k) { return a2uiRender(k, byId, dataModel, scope); }).join('');
        return '<div style="display:flex;flex-direction:column;gap:8px">' + colKids + '</div>';
      }
      case 'Row': {
        var rowKids = (c.children || []).map(function(k) { return a2uiRender(k, byId, dataModel, scope); }).join('');
        return '<div style="display:flex;flex-direction:row;gap:8px;align-items:center">' + rowKids + '</div>';
      }
      case 'Card': {
        var inner = c.child ? a2uiRender(c.child, byId, dataModel, scope) : '';
        return '<div style="border:1px solid ' + colors.border + ';border-radius:8px;padding:12px;background:' + colors.bg + '">' + inner + '</div>';
      }
      case 'Divider': {
        return '<hr style="border:0;border-top:1px solid ' + colors.border + ';margin:8px 0" />';
      }
      case 'Image': {
        var url = a2uiResolveDynamic(c.url, dataModel, scope);
        var alt = a2uiResolveDynamic(c.alt, dataModel, scope);
        return '<img src="' + esc(String(url || '')) + '" alt="' + esc(String(alt || '')) + '" style="max-width:100%;border-radius:6px" />';
      }
      case 'List': {
        var list = c.list || {};
        var tplId = list.template && list.template.id;
        var pathObj = list.data && list.data.path ? list.data.path : '';
        var items = a2uiResolvePath(dataModel, pathObj, scope);
        if (!tplId || !Array.isArray(items)) return '';
        return '<div style="display:flex;flex-direction:column;gap:8px">' +
          items.map(function(item, i) {
            return '<div data-a2ui-list-index="' + i + '">' + a2uiRender(tplId, byId, dataModel, item) + '</div>';
          }).join('') +
          '</div>';
      }
      case 'Button': {
        var label = a2uiResolveDynamic(c.text, dataModel, scope);
        var variant = c.variant || 'primary';
        var actionName = (c.action && c.action.event && c.action.event.name) ||
                         (c.action && c.action.functionCall && c.action.functionCall.call) || '';
        var style = variant === 'primary'
          ? 'background:' + colors.accent + ';color:#fff;border:0;padding:8px 14px;border-radius:6px;font-weight:500;cursor:pointer'
          : 'background:transparent;color:' + colors.accent + ';border:0;padding:8px 14px;border-radius:6px;font-weight:500;cursor:pointer';
        return '<button data-a2ui-action="' + esc(String(actionName)) + '" style="' + style + '">' + esc(String(label || '')) + '</button>';
      }
      case 'TextField': {
        var fieldLabel = a2uiResolveDynamic(c.label, dataModel, scope);
        var valuePath = c.value && c.value.path;
        var val = valuePath ? a2uiResolvePath(dataModel, valuePath, scope) : '';
        // data-a2ui-input carries the JSON Pointer to write user edits back
        // into the local data-model snapshot so the next button click ships
        // current input values in its action context.
        var inputAttr = valuePath ? ' data-a2ui-input="' + esc(String(valuePath)) + '"' : '';
        return '<label style="display:flex;flex-direction:column;gap:4px;font-size:13px">' +
          (fieldLabel ? '<span style="color:' + colors.textMuted + '">' + esc(String(fieldLabel)) + '</span>' : '') +
          '<input type="text" value="' + esc(String(val == null ? '' : val)) + '"' + inputAttr + ' style="padding:8px;border:1px solid ' + colors.border + ';border-radius:6px;background:' + colors.bg + ';color:' + colors.text + '" />' +
          '</label>';
      }
      default: {
        return '<div style="font-size:12px;color:' + colors.textMuted + ';padding:8px;border:1px dashed ' + colors.border + ';border-radius:6px">[A2UI: unsupported \\u201C' + esc(String(kind)) + '\\u201D component in Basic catalog]</div>';
      }
    }
  }

  function a2uiToast(container, message) {
    var el = document.createElement('div');
    el.textContent = message;
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:' + colors.accent + ';color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
    document.body.appendChild(el);
    setTimeout(function() { el.remove(); }, 2500);
  }

  // ─── Code (syntax-highlighted) ───
  renderers.code = function(container, data) {
    var text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    var root = getComputedStyle(document.documentElement);
    var get = function(prop, fb) { return root.getPropertyValue(prop).trim() || fb; };
    var sc = {
      comment: get('--syntax-comment', '#6a737d'),
      keyword: get('--syntax-keyword', '#ff7b72'),
      string:  get('--syntax-string', '#a5d6ff'),
      number:  get('--syntax-number', '#ff9e64'),
      fn:      get('--syntax-function', '#d2a8ff'),
    };
    // Tokenize then reassemble — avoids regex-on-HTML issues from esc()
    var lines = text.split('\\n');
    var out = [];
    for (var li = 0; li < lines.length; li++) {
      var line = esc(lines[li]);
      // Comments (// ...)
      var ci = line.indexOf('//');
      var tail = '';
      if (ci >= 0) { tail = '<span style="color:' + sc.comment + '">' + line.slice(ci) + '</span>'; line = line.slice(0, ci); }
      // Strings: 'x', "x" — esc() converts " to &quot; but leaves ' as-is
      line = line.replace(/(&quot;[^&]*?&quot;|'[^']*?')/g, '<span style="color:' + sc.string + '">$1</span>');
      // Keywords
      line = line.replace(/\\b(const|let|var|function|async|await|return|if|else|for|while|new|class|import|export|from|default|this|typeof|try|catch|throw|of|in)\\b/g, '<span style="color:' + sc.keyword + '">$1</span>');
      // Numbers
      line = line.replace(/\\b(\\d+\\.?\\d*)\\b/g, '<span style="color:' + sc.number + '">$1</span>');
      // Function calls
      line = line.replace(/([a-zA-Z_$][\\w$]*)\\s*\\(/g, '<span style="color:' + sc.fn + '">$1</span>(');
      out.push(line + tail);
    }
    container.innerHTML = '<pre style="font-size:12px;line-height:1.6;color:' + colors.text + ';background:' + colors.bgAlt + ';padding:12px 16px;border-radius:6px;overflow:auto;max-height:500px;margin:0;tab-size:2"><code>' + out.join('\\n') + '</code></pre>';
  };

  // ─── KV (key-value card) ───
  renderers.card = renderers.kv = function(container, data, opts) {
    if (typeof data !== 'object' || Array.isArray(data)) { renderers.json(container, data); return; }
    var keys = Object.keys(data);
    var h = '<div style="display:grid;gap:1px">';
    for (var i = 0; i < keys.length; i++) {
      h += '<div style="display:flex;justify-content:space-between;padding:8px 12px;background:' + (i % 2 === 0 ? colors.bg : colors.bgAlt) + ';border-bottom:1px solid ' + colors.border + '">' +
        '<span style="font-size:12px;color:' + colors.textMuted + ';font-weight:500">' + esc(formatLabel(keys[i])) + '</span>' +
        '<span style="font-size:13px;color:' + colors.text + '">' + formatValue(data[keys[i]]) + '</span>' +
        '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Helpers ───

  function _findKey(obj, candidates) {
    if (!obj || typeof obj !== 'object') return null;
    var keys = Object.keys(obj);
    for (var i = 0; i < candidates.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === candidates[i].toLowerCase()) return keys[j];
      }
    }
    return null;
  }

  function _badgeVariant(text) {
    if (!text) return 'neutral';
    var t = String(text).toLowerCase();
    if (/^(active|connected|online|success|done|complete|paid|approved|yes|true|enabled|healthy|running)$/.test(t)) return 'success';
    if (/^(error|failed|offline|disconnected|rejected|blocked|critical|dead)$/.test(t)) return 'error';
    if (/^(warning|pending|queued|waiting|paused|delayed|degraded)$/.test(t)) return 'warning';
    if (/^(info|new|open|in.progress|processing|active)$/.test(t)) return 'info';
    return 'neutral';
  }

  function _formatDate(v) {
    try { var d = new Date(v); return isNaN(d) ? v : d.toLocaleString(); }
    catch(e) { return v; }
  }

  // ─── QR code ───
  var _loadQRJS = _makeLoader('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js');

  renderers.qr = function(container, data) {
    var text = typeof data === 'object' && data !== null
      ? String(data.qr || data.url || data.link || data.value || JSON.stringify(data))
      : String(data);
    var isUrl = /^https?:\\/\\//i.test(text);
    container.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:16px">' +
      '<div id="_qr_canvas" style="background:#fff;padding:12px;border-radius:8px"></div>' +
      (isUrl ? '<a href="' + esc(text) + '" target="_blank" rel="noopener noreferrer" style="font-size:12px;color:' + colors.accent + ';word-break:break-all;text-align:center">' + esc(text) + '</a>' : '<span style="font-size:12px;color:' + colors.textMuted + ';word-break:break-all;text-align:center">' + esc(text) + '</span>') +
      '</div>';
    var canvas = container.querySelector('#_qr_canvas');
    _loadQRJS(function() {
      if (!canvas || !window.QRCode) return;
      try {
        var size = Math.max(160, Math.min(container.clientWidth - 64, 280));
        new window.QRCode(canvas, { text: text, width: size, height: size, colorDark: '#000000', colorLight: '#ffffff' });
      } catch(e) { canvas.textContent = text; }
    });
  };

  var _loadChartJS = _makeLoader('https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js');

  // ─── Steps/Stepper ───
  renderers.steps = renderers.stepper = function(container, data) {
    var items = Array.isArray(data) ? data : (data.steps || [data]);
    var h = '<div style="display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding:12px 4px">';
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      var label = s.label || s.title || s.name || ('Step ' + (i + 1));
      var status = (s.status || 'pending').toLowerCase();
      var detail = s.detail || s.description || '';
      var isComplete = status === 'complete' || status === 'completed' || status === 'done';
      var isCurrent = status === 'current' || status === 'active' || status === 'in-progress' || status === 'running';
      var circleColor = isComplete ? '#34d399' : isCurrent ? colors.accent : colors.border;
      var circleContent = isComplete ? '\\u2713' : String(i + 1);
      var textColor = isComplete || isCurrent ? colors.text : colors.textMuted;
      // Connector before circle — green if the previous step is complete
      if (i > 0) {
        var prevStatus = (items[i - 1].status || 'pending').toLowerCase();
        var prevComplete = prevStatus === 'complete' || prevStatus === 'completed' || prevStatus === 'done';
        h += '<div style="flex:1;min-width:20px;max-width:60px;height:2px;background:' + (prevComplete ? '#34d399' : colors.border) + ';align-self:center;margin-top:-20px"></div>';
      }
      // Step column
      h += '<div style="display:flex;flex-direction:column;align-items:center;min-width:60px;flex-shrink:0">';
      h += '<div style="width:32px;height:32px;border-radius:50%;background:' + circleColor + ';color:' + (isComplete || isCurrent ? '#fff' : colors.textMuted) + ';display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0">' + circleContent + '</div>';
      h += '<div style="text-align:center;margin-top:6px;font-size:11px;font-weight:500;color:' + textColor + ';white-space:nowrap">' + esc(label) + '</div>';
      if (detail) h += '<div style="text-align:center;font-size:10px;color:' + colors.textMuted + ';white-space:nowrap">' + esc(detail) + '</div>';
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Stat Group (row of KPI metrics) ───
  renderers['stat-group'] = renderers.statgroup = function(container, data) {
    var items = Array.isArray(data) ? data : [data];
    var h = '<div style="display:flex;gap:12px;flex-wrap:wrap">';
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      var value = m.value != null ? m.value : '';
      var label = m.label || m.name || m.title || '';
      var prefix = m.prefix || '';
      var suffix = m.suffix || m.unit || '';
      var delta = m.delta;
      var trend = m.trend || (typeof delta === 'number' ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat') : null);
      var display = typeof value === 'number' ? formatValue(value) : esc(String(value));
      var trendHtml = '';
      if (trend) {
        var arrow = trend === 'up' ? '\\u2191' : trend === 'down' ? '\\u2193' : '\\u2192';
        var tc = trend === 'up' ? '#34d399' : trend === 'down' ? '#f87171' : colors.textMuted;
        trendHtml = '<span style="font-size:12px;color:' + tc + '">' + arrow + (delta != null ? ' ' + (delta > 0 ? '+' : '') + formatValue(delta) : '') + '</span>';
      }
      h += '<div style="flex:1;min-width:120px;padding:16px;background:' + colors.bgAlt + ';border-radius:8px;border:1px solid ' + colors.border + '">';
      h += '<div style="font-size:24px;font-weight:700;color:' + colors.text + '">' + esc(prefix) + display + esc(suffix) + ' ' + trendHtml + '</div>';
      if (label) h += '<div style="font-size:12px;color:' + colors.textMuted + ';margin-top:2px">' + esc(label) + '</div>';
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Log (severity-colored log viewer) ───
  renderers.log = function(container, data) {
    var items = Array.isArray(data) ? data : [data];
    var levelColors = { error: '#f87171', warn: '#fbbf24', warning: '#fbbf24', info: colors.accent, debug: colors.textMuted, trace: colors.textMuted };
    var h = '<div style="font-family:monospace;font-size:12px;line-height:1.6;background:' + colors.bgAlt + ';border-radius:6px;padding:8px 12px;max-height:400px;overflow:auto">';
    for (var i = 0; i < items.length; i++) {
      var entry = items[i];
      var level = (entry.level || entry.severity || 'info').toLowerCase();
      var msg = entry.message || entry.msg || entry.text || (typeof entry === 'string' ? entry : JSON.stringify(entry));
      var ts = entry.timestamp || entry.time || entry.ts || '';
      var src = entry.source || entry.logger || '';
      var lc = levelColors[level] || colors.textMuted;
      h += '<div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid ' + colors.border + '">';
      if (ts) h += '<span style="color:' + colors.textMuted + ';flex-shrink:0">' + esc(typeof ts === 'string' ? ts.replace('T', ' ').slice(0, 19) : String(ts)) + '</span>';
      h += '<span style="color:' + lc + ';font-weight:600;min-width:40px;text-transform:uppercase;flex-shrink:0">' + esc(level.slice(0, 4)) + '</span>';
      if (src) h += '<span style="color:' + colors.textMuted + ';flex-shrink:0">[' + esc(src) + ']</span>';
      h += '<span style="color:' + colors.text + '">' + esc(msg) + '</span>';
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Image ───
  renderers.image = function(container, data) {
    var items = Array.isArray(data) ? data : [typeof data === 'string' ? { src: data } : data];
    if (items.length === 1) {
      var img = items[0];
      var src = img.src || img.url || img.image || (typeof data === 'string' ? data : '');
      var alt = img.alt || img.caption || img.title || '';
      var caption = img.caption || img.title || '';
      var h = '<div style="text-align:center">';
      h += '<img src="' + esc(src) + '" alt="' + esc(alt) + '" style="max-width:100%;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.2)" />';
      if (caption) h += '<div style="font-size:12px;color:' + colors.textMuted + ';margin-top:8px">' + esc(caption) + '</div>';
      h += '</div>';
      container.innerHTML = h;
    } else {
      // Gallery grid
      var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">';
      for (var i = 0; i < items.length; i++) {
        var img = items[i];
        var src = img.src || img.url || img.image || '';
        var caption = img.caption || img.title || '';
        h += '<div style="text-align:center">';
        h += '<img src="' + esc(src) + '" alt="' + esc(caption) + '" style="width:100%;border-radius:6px;aspect-ratio:1;object-fit:cover" />';
        if (caption) h += '<div style="font-size:11px;color:' + colors.textMuted + ';margin-top:4px">' + esc(caption) + '</div>';
        h += '</div>';
      }
      h += '</div>';
      container.innerHTML = h;
    }
  };

  // ─── Hero ───
  renderers.hero = function(container, data) {
    var d = typeof data === 'string' ? { title: data } : data;
    var title = d.title || d.heading || '';
    var subtitle = d.subtitle || d.description || d.text || '';
    var image = d.image || d.bg || d.background || '';
    var cta = d.cta || d.action || d.button || '';
    var ctaUrl = d.url || d.link || d.href || '#';
    var bgStyle = image ? 'background:linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.7)),url(' + esc(image) + ') center/cover' : 'background:linear-gradient(135deg,' + colors.accent + '22,' + colors.bgAlt + ')';
    var h = '<div style="' + bgStyle + ';border-radius:12px;padding:48px 32px;text-align:center">';
    h += '<h2 style="font-size:28px;font-weight:700;color:' + colors.text + ';margin:0 0 8px">' + esc(title) + '</h2>';
    if (subtitle) h += '<p style="font-size:15px;color:' + colors.textMuted + ';margin:0 0 20px;max-width:600px;margin-left:auto;margin-right:auto">' + esc(subtitle) + '</p>';
    if (cta) h += '<a href="' + esc(ctaUrl) + '" style="display:inline-block;padding:10px 24px;background:' + colors.accent + ';color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">' + esc(cta) + '</a>';
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Banner ───
  renderers.banner = function(container, data) {
    var d = typeof data === 'string' ? { message: data } : data;
    var message = d.message || d.text || d.title || '';
    var type = (d.type || d.variant || d.severity || 'info').toLowerCase();
    var icon = d.icon || '';
    var bc = VARIANT_COLORS[type] || VARIANT_COLORS.info;
    var h = '<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:' + bc + '18;border:1px solid ' + bc + '44;border-radius:8px;border-left:4px solid ' + bc + '">';
    if (icon) h += '<span style="font-size:18px;flex-shrink:0">' + esc(icon) + '</span>';
    h += '<span style="font-size:13px;color:' + colors.text + '">' + esc(message) + '</span>';
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Quote ───
  renderers.quote = function(container, data) {
    var d = typeof data === 'string' ? { text: data } : data;
    var text = d.text || d.quote || d.content || d.message || '';
    var author = d.author || d.name || d.by || d.attribution || '';
    var source = d.source || d.from || d.publication || '';
    var avatar = d.avatar || d.image || '';
    var h = '<div style="border-left:3px solid ' + colors.accent + ';padding:16px 20px;background:' + colors.bgAlt + ';border-radius:0 8px 8px 0">';
    h += '<div style="font-size:15px;color:' + colors.text + ';font-style:italic;line-height:1.6">\\u201C' + esc(text) + '\\u201D</div>';
    if (author || source) {
      h += '<div style="display:flex;align-items:center;gap:8px;margin-top:12px">';
      if (avatar) h += '<img src="' + esc(avatar) + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />';
      h += '<div>';
      if (author) h += '<div style="font-size:13px;font-weight:600;color:' + colors.text + '">' + esc(author) + '</div>';
      if (source) h += '<div style="font-size:11px;color:' + colors.textMuted + '">' + esc(source) + '</div>';
      h += '</div></div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Profile ───
  renderers.profile = function(container, data) {
    var d = typeof data === 'object' && data !== null ? data : { name: String(data) };
    var name = d.name || d.displayName || d.username || '';
    var avatar = d.avatar || d.image || d.photo || '';
    var role = d.role || d.title || d.position || '';
    var bio = d.bio || d.description || d.about || '';
    var stats = d.stats || {};
    var h = '<div style="display:flex;flex-direction:column;align-items:center;padding:24px;background:' + colors.bgAlt + ';border-radius:12px;border:1px solid ' + colors.border + '">';
    if (avatar) h += '<img src="' + esc(avatar) + '" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin-bottom:12px;border:2px solid ' + colors.border + '" />';
    else h += '<div style="width:72px;height:72px;border-radius:50%;background:' + colors.accent + ';display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#fff;margin-bottom:12px">' + esc(name.charAt(0).toUpperCase()) + '</div>';
    h += '<div style="font-size:18px;font-weight:700;color:' + colors.text + '">' + esc(name) + '</div>';
    if (role) h += '<div style="font-size:13px;color:' + colors.accent + ';margin-top:2px">' + esc(role) + '</div>';
    if (bio) h += '<div style="font-size:13px;color:' + colors.textMuted + ';margin-top:8px;text-align:center;max-width:300px">' + esc(bio) + '</div>';
    var statKeys = Object.keys(stats);
    if (statKeys.length > 0) {
      h += '<div style="display:flex;gap:20px;margin-top:16px;padding-top:16px;border-top:1px solid ' + colors.border + '">';
      for (var i = 0; i < statKeys.length; i++) {
        h += '<div style="text-align:center"><div style="font-size:18px;font-weight:700;color:' + colors.text + '">' + formatValue(stats[statKeys[i]]) + '</div>';
        h += '<div style="font-size:11px;color:' + colors.textMuted + '">' + esc(formatLabel(statKeys[i])) + '</div></div>';
      }
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Feature Grid ───
  renderers['feature-grid'] = renderers.features = function(container, data) {
    var items = Array.isArray(data) ? data : [data];
    var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">';
    for (var i = 0; i < items.length; i++) {
      var f = items[i];
      var icon = f.icon || f.emoji || '';
      var title = f.title || f.name || f.label || '';
      var desc = f.description || f.text || f.detail || '';
      h += '<div style="padding:20px;background:' + colors.bgAlt + ';border-radius:10px;border:1px solid ' + colors.border + '">';
      if (icon) h += '<div style="font-size:24px;margin-bottom:8px">' + esc(icon) + '</div>';
      h += '<div style="font-size:14px;font-weight:600;color:' + colors.text + '">' + esc(title) + '</div>';
      if (desc) h += '<div style="font-size:12px;color:' + colors.textMuted + ';margin-top:4px;line-height:1.5">' + esc(desc) + '</div>';
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Diff ───
  renderers.diff = function(container, data) {
    var text = '';
    if (typeof data === 'string') {
      text = data;
    } else if (data && data.before != null && data.after != null) {
      // Simple line-by-line diff
      var before = String(data.before).split('\\n');
      var after = String(data.after).split('\\n');
      var filename = data.filename || data.file || '';
      if (filename) text += '--- a/' + filename + '\\n+++ b/' + filename + '\\n';
      var maxLen = Math.max(before.length, after.length);
      for (var di = 0; di < maxLen; di++) {
        if (di >= before.length) text += '+' + after[di] + '\\n';
        else if (di >= after.length) text += '-' + before[di] + '\\n';
        else if (before[di] !== after[di]) { text += '-' + before[di] + '\\n+' + after[di] + '\\n'; }
        else text += ' ' + before[di] + '\\n';
      }
    } else {
      text = JSON.stringify(data, null, 2);
    }
    var lines = text.split('\\n');
    var h = '<pre style="font-size:12px;line-height:1.5;font-family:monospace;background:' + colors.bgAlt + ';border-radius:6px;padding:12px;overflow:auto;max-height:500px;margin:0">';
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lineColor = colors.text;
      var lineBg = 'transparent';
      if (line.charAt(0) === '+' && !line.startsWith('+++')) { lineColor = '#34d399'; lineBg = '#34d39910'; }
      else if (line.charAt(0) === '-' && !line.startsWith('---')) { lineColor = '#f87171'; lineBg = '#f8717110'; }
      else if (line.startsWith('@@')) { lineColor = colors.accent; }
      else if (line.startsWith('---') || line.startsWith('+++')) { lineColor = colors.textMuted; }
      h += '<div style="color:' + lineColor + ';background:' + lineBg + ';padding:0 4px;white-space:pre">' + esc(line) + '</div>';
    }
    h += '</pre>';
    container.innerHTML = h;
  };

  // ─── Carousel ───
  renderers.carousel = function(container, data) {
    var items = Array.isArray(data) ? data : [typeof data === 'string' ? { src: data } : data];
    var id = '_carousel_' + Math.random().toString(36).slice(2, 8);
    var h = '<div id="' + id + '" style="position:relative;overflow:hidden;border-radius:10px">';
    // Slides
    h += '<div class="slides" style="display:flex;transition:transform 0.4s ease;width:100%">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var src = item.src || item.url || item.image || '';
      var caption = item.caption || item.title || '';
      h += '<div style="min-width:100%;box-sizing:border-box">';
      h += '<img src="' + esc(src) + '" style="width:100%;display:block;aspect-ratio:16/9;object-fit:cover" />';
      if (caption) h += '<div style="padding:8px 12px;font-size:12px;color:' + colors.textMuted + ';background:' + colors.bgAlt + '">' + esc(caption) + '</div>';
      h += '</div>';
    }
    h += '</div>';
    // Nav arrows
    if (items.length > 1) {
      h += '<button onclick="(function(el){var s=el.closest(&quot;[id]&quot;).querySelector(&quot;.slides&quot;);var idx=+(s.dataset.idx||0);idx=idx>0?idx-1:' + (items.length - 1) + ';s.style.transform=&quot;translateX(-&quot;+idx*100+&quot;%)&quot;;s.dataset.idx=idx})(this)" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px">\\u2039</button>';
      h += '<button onclick="(function(el){var s=el.closest(&quot;[id]&quot;).querySelector(&quot;.slides&quot;);var idx=+(s.dataset.idx||0);idx=idx<' + (items.length - 1) + '?idx+1:0;s.style.transform=&quot;translateX(-&quot;+idx*100+&quot;%)&quot;;s.dataset.idx=idx})(this)" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px">\\u203A</button>';
      // Dots
      h += '<div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;gap:6px">';
      for (var j = 0; j < items.length; j++) {
        h += '<div style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,' + (j === 0 ? '0.9' : '0.4') + ')"></div>';
      }
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Gallery (lightbox grid) ───
  renderers.gallery = function(container, data) {
    var items = Array.isArray(data) ? data : [typeof data === 'string' ? { src: data } : data];
    var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var src = item.src || item.url || item.image || item.thumbnail || '';
      var full = item.full || item.original || src;
      var caption = item.caption || item.title || '';
      h += '<div style="cursor:pointer;overflow:hidden;border-radius:6px;aspect-ratio:1" onclick="(function(s,c){var o=document.createElement(&quot;div&quot;);o.style.cssText=&quot;position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:pointer&quot;;o.onclick=function(){o.remove()};var img=document.createElement(&quot;img&quot;);img.src=s;img.style.cssText=&quot;max-width:90%;max-height:85vh;border-radius:8px&quot;;o.appendChild(img);if(c){var p=document.createElement(&quot;div&quot;);p.style.cssText=&quot;color:#fff;font-size:13px;margin-top:8px&quot;;p.textContent=c;o.appendChild(p)}document.body.appendChild(o))(&quot;' + esc(full) + '&quot;,&quot;' + esc(caption) + '&quot;)">';
      h += '<img src="' + esc(src) + '" alt="' + esc(caption) + '" style="width:100%;height:100%;object-fit:cover" />';
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Masonry ───
  renderers.masonry = function(container, data) {
    var items = Array.isArray(data) ? data : [typeof data === 'string' ? { src: data } : data];
    // CSS columns-based masonry
    var h = '<div style="columns:3 200px;column-gap:8px">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var src = item.src || item.url || item.image || '';
      var caption = item.caption || item.title || '';
      h += '<div style="break-inside:avoid;margin-bottom:8px;border-radius:8px;overflow:hidden;background:' + colors.bgAlt + '">';
      h += '<img src="' + esc(src) + '" style="width:100%;display:block" />';
      if (caption) h += '<div style="padding:6px 8px;font-size:11px;color:' + colors.textMuted + '">' + esc(caption) + '</div>';
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Kanban ───
  renderers.kanban = function(container, data) {
    var columns = data.columns || data.lanes || [];
    if (!Array.isArray(columns) && typeof data === 'object') {
      // Convert object keys to columns: { "To Do": [...], "Done": [...] }
      columns = Object.keys(data).map(function(k) { return { title: k, items: data[k] }; });
    }
    var h = '<div style="display:flex;gap:12px;overflow-x:auto;padding:8px 0;min-height:200px">';
    for (var ci = 0; ci < columns.length; ci++) {
      var col = columns[ci];
      var title = col.title || col.name || col.label || ('Column ' + (ci + 1));
      var items = col.items || col.cards || col.tasks || [];
      h += '<div style="min-width:220px;max-width:280px;flex:1;background:' + colors.bgAlt + ';border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px">';
      h += '<div style="font-size:12px;font-weight:600;color:' + colors.textMuted + ';text-transform:uppercase;letter-spacing:0.5px;display:flex;justify-content:space-between">' + esc(title) + '<span style="background:' + colors.border + ';border-radius:10px;padding:0 6px;font-size:11px">' + items.length + '</span></div>';
      for (var ki = 0; ki < items.length; ki++) {
        var card = items[ki];
        var cardTitle = card.title || card.name || card.label || (typeof card === 'string' ? card : JSON.stringify(card));
        var assignee = card.assignee || card.owner || '';
        var priority = card.priority || '';
        var prColor = priority === 'high' || priority === 'urgent' ? '#f87171' : priority === 'medium' ? '#fbbf24' : '';
        h += '<div style="padding:10px;background:' + colors.bg + ';border-radius:6px;border:1px solid ' + colors.border + ';font-size:13px">';
        if (prColor) h += '<div style="width:6px;height:6px;border-radius:50%;background:' + prColor + ';display:inline-block;margin-right:4px"></div>';
        h += '<span style="color:' + colors.text + '">' + esc(String(cardTitle)) + '</span>';
        if (assignee) h += '<div style="font-size:11px;color:' + colors.textMuted + ';margin-top:4px">' + esc(assignee) + '</div>';
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Heatmap ───
  renderers.heatmap = function(container, data) {
    var rows, cols, values;
    if (Array.isArray(data)) {
      // Flat array: [{ day, hour, value }]
      var rowSet = {}, colSet = {}, valMap = {};
      for (var fi = 0; fi < data.length; fi++) {
        var keys = Object.keys(data[fi]);
        var rk = keys[0], ck = keys[1], vk = keys[2] || 'value';
        var rv = String(data[fi][rk]), cv = String(data[fi][ck]);
        rowSet[rv] = 1; colSet[cv] = 1;
        valMap[rv + '|' + cv] = data[fi][vk];
      }
      rows = Object.keys(rowSet);
      cols = Object.keys(colSet);
      values = [];
      for (var ri = 0; ri < rows.length; ri++) {
        var row = [];
        for (var cj = 0; cj < cols.length; cj++) {
          row.push(valMap[rows[ri] + '|' + cols[cj]] || 0);
        }
        values.push(row);
      }
    } else {
      rows = data.rows || [];
      cols = data.cols || data.columns || [];
      values = data.values || data.data || [];
    }
    // Find min/max for normalization
    var min = Infinity, max = -Infinity;
    for (var hi = 0; hi < values.length; hi++) {
      for (var hj = 0; hj < values[hi].length; hj++) {
        var v = values[hi][hj];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === max) max = min + 1;
    function heatColor(norm) {
      // Cold (blue) → Warm (yellow) → Hot (red)
      var r, g, b;
      if (norm < 0.5) { var t = norm * 2; r = Math.round(30 + t * 220); g = Math.round(100 + t * 80); b = Math.round(200 - t * 150); }
      else { var t2 = (norm - 0.5) * 2; r = Math.round(250); g = Math.round(180 - t2 * 130); b = Math.round(50 - t2 * 40); }
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }
    var cellSize = Math.max(24, Math.min(40, Math.floor(400 / Math.max(cols.length, 1))));
    var h = '<div style="overflow:auto"><table style="border-collapse:collapse;font-size:11px">';
    // Header row
    h += '<tr><td></td>';
    for (var ci = 0; ci < cols.length; ci++) {
      h += '<td style="padding:4px;text-align:center;color:' + colors.textMuted + ';font-weight:500">' + esc(String(cols[ci])) + '</td>';
    }
    h += '</tr>';
    // Data rows
    for (var ri = 0; ri < rows.length; ri++) {
      h += '<tr><td style="padding:4px 8px 4px 0;color:' + colors.textMuted + ';font-weight:500;white-space:nowrap">' + esc(String(rows[ri])) + '</td>';
      for (var cj = 0; cj < (values[ri] || []).length; cj++) {
        var val = values[ri][cj];
        var norm = (val - min) / (max - min);
        h += '<td style="width:' + cellSize + 'px;height:' + cellSize + 'px;background:' + heatColor(norm) + ';border-radius:3px;text-align:center;color:#fff;font-size:10px;font-weight:600;padding:2px" title="' + esc(String(val)) + '">' + (cellSize >= 30 ? val : '') + '</td>';
      }
      h += '</tr>';
    }
    h += '</table></div>';
    container.innerHTML = h;
  };

  // ─── Comparison ───
  renderers.comparison = function(container, data) {
    var items = data.items || data.plans || data.options || (Array.isArray(data) ? data : []);
    var highlight = data.highlight || data.recommended || '';
    if (!items.length) { renderers.json(container, data); return; }
    // Gather all property keys
    var allKeys = [];
    for (var i = 0; i < items.length; i++) {
      var keys = Object.keys(items[i]).filter(function(k) { return k !== 'name' && k !== 'title' && k !== 'plan'; });
      for (var j = 0; j < keys.length; j++) {
        if (allKeys.indexOf(keys[j]) < 0) allKeys.push(keys[j]);
      }
    }
    var h = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">';
    // Header
    h += '<tr><th style="padding:12px;text-align:left;border-bottom:2px solid ' + colors.border + '"></th>';
    for (var i = 0; i < items.length; i++) {
      var name = items[i].name || items[i].title || items[i].plan || ('Option ' + (i + 1));
      var isHL = name === highlight;
      h += '<th style="padding:12px;text-align:center;border-bottom:2px solid ' + colors.border + ';' + (isHL ? 'background:' + colors.accent + '18;' : '') + '">';
      h += '<div style="font-weight:700;color:' + colors.text + '">' + esc(name) + '</div>';
      if (isHL) h += '<div style="font-size:10px;color:' + colors.accent + ';margin-top:2px">Recommended</div>';
      h += '</th>';
    }
    h += '</tr>';
    // Rows
    for (var ki = 0; ki < allKeys.length; ki++) {
      var key = allKeys[ki];
      h += '<tr>';
      h += '<td style="padding:8px 12px;color:' + colors.textMuted + ';font-weight:500;border-bottom:1px solid ' + colors.border + '">' + esc(formatLabel(key)) + '</td>';
      for (var i = 0; i < items.length; i++) {
        var val = items[i][key];
        var isHL = (items[i].name || items[i].title || items[i].plan) === highlight;
        var display = val === true ? '\\u2713' : val === false ? '\\u2717' : (val != null ? formatValue(val) : '\\u2014');
        var valColor = val === true ? '#34d399' : val === false ? '#f87171' : colors.text;
        h += '<td style="padding:8px 12px;text-align:center;border-bottom:1px solid ' + colors.border + ';color:' + valColor + ';' + (isHL ? 'background:' + colors.accent + '08;' : '') + '">' + display + '</td>';
      }
      h += '</tr>';
    }
    h += '</table></div>';
    container.innerHTML = h;
  };

  // ─── Invoice/Receipt ───
  renderers.invoice = renderers.receipt = function(container, data) {
    var d = data;
    var h = '<div style="background:' + colors.bgAlt + ';border-radius:10px;padding:24px;max-width:600px;margin:0 auto;border:1px solid ' + colors.border + '">';
    // Header
    var num = d.number || d.id || '';
    var date = d.date || '';
    var due = d.due || d.dueDate || '';
    if (num || date) {
      h += '<div style="display:flex;justify-content:space-between;margin-bottom:20px">';
      h += '<div><div style="font-size:20px;font-weight:700;color:' + colors.text + '">' + (d.title || 'Invoice') + '</div>';
      if (num) h += '<div style="font-size:12px;color:' + colors.textMuted + '">' + esc(num) + '</div>';
      h += '</div>';
      if (date) h += '<div style="text-align:right;font-size:12px;color:' + colors.textMuted + '">Date: ' + esc(date) + (due ? '<br>Due: ' + esc(due) : '') + '</div>';
      h += '</div>';
    }
    // From / To
    var from = d.from;
    var to = d.to;
    if (from || to) {
      h += '<div style="display:flex;gap:24px;margin-bottom:20px;font-size:12px">';
      if (from) {
        h += '<div><div style="font-weight:600;color:' + colors.textMuted + ';margin-bottom:4px">FROM</div>';
        h += '<div style="color:' + colors.text + '">' + esc(typeof from === 'string' ? from : (from.name || '')) + '</div>';
        if (from.address) h += '<div style="color:' + colors.textMuted + '">' + esc(from.address) + '</div>';
        h += '</div>';
      }
      if (to) {
        h += '<div><div style="font-weight:600;color:' + colors.textMuted + ';margin-bottom:4px">TO</div>';
        h += '<div style="color:' + colors.text + '">' + esc(typeof to === 'string' ? to : (to.name || '')) + '</div>';
        if (to.address) h += '<div style="color:' + colors.textMuted + '">' + esc(to.address) + '</div>';
        h += '</div>';
      }
      h += '</div>';
    }
    // Items
    var items = d.items || d.lineItems || [];
    if (items.length > 0) {
      h += '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">';
      h += '<tr style="border-bottom:1px solid ' + colors.border + '"><th style="text-align:left;padding:8px 4px;color:' + colors.textMuted + '">Item</th><th style="text-align:right;padding:8px 4px;color:' + colors.textMuted + '">Qty</th><th style="text-align:right;padding:8px 4px;color:' + colors.textMuted + '">Price</th><th style="text-align:right;padding:8px 4px;color:' + colors.textMuted + '">Amount</th></tr>';
      for (var ii = 0; ii < items.length; ii++) {
        var item = items[ii];
        h += '<tr style="border-bottom:1px solid ' + colors.border + '">';
        h += '<td style="padding:8px 4px;color:' + colors.text + '">' + esc(item.description || item.name || item.item || '') + '</td>';
        h += '<td style="padding:8px 4px;text-align:right;color:' + colors.textMuted + '">' + (item.quantity || item.qty || 1) + '</td>';
        h += '<td style="padding:8px 4px;text-align:right;color:' + colors.textMuted + '">' + formatValue(item.rate || item.price || item.unitPrice || 0) + '</td>';
        h += '<td style="padding:8px 4px;text-align:right;color:' + colors.text + ';font-weight:500">' + formatValue(item.amount || item.total || 0) + '</td>';
        h += '</tr>';
      }
      h += '</table>';
    }
    // Totals
    if (d.subtotal != null || d.total != null) {
      h += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:13px">';
      if (d.subtotal != null) h += '<div><span style="color:' + colors.textMuted + ';margin-right:20px">Subtotal</span><span style="color:' + colors.text + '">' + formatValue(d.subtotal) + '</span></div>';
      if (d.tax != null) h += '<div><span style="color:' + colors.textMuted + ';margin-right:20px">Tax</span><span style="color:' + colors.text + '">' + formatValue(d.tax) + '</span></div>';
      if (d.discount != null) h += '<div><span style="color:' + colors.textMuted + ';margin-right:20px">Discount</span><span style="color:#34d399">-' + formatValue(d.discount) + '</span></div>';
      if (d.total != null) h += '<div style="border-top:2px solid ' + colors.border + ';padding-top:8px;margin-top:4px"><span style="color:' + colors.text + ';font-weight:700;margin-right:20px">Total</span><span style="color:' + colors.text + ';font-weight:700;font-size:16px">' + formatValue(d.total) + '</span></div>';
      h += '</div>';
    }
    // Notes
    if (d.notes) h += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid ' + colors.border + ';font-size:11px;color:' + colors.textMuted + '">' + esc(d.notes) + '</div>';
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Cron ───
  renderers.cron = function(container, data) {
    var expr = typeof data === 'string' ? data : (data.expression || data.cron || '');
    var desc = typeof data === 'object' ? (data.description || '') : '';
    // Simple cron field labels
    var parts = expr.trim().split(/\\s+/);
    var fields = ['Minute', 'Hour', 'Day', 'Month', 'Weekday'];
    var h = '<div style="padding:12px;background:' + colors.bgAlt + ';border-radius:8px;border:1px solid ' + colors.border + '">';
    h += '<div style="font-family:monospace;font-size:16px;font-weight:700;color:' + colors.accent + ';margin-bottom:8px">' + esc(expr) + '</div>';
    if (desc) h += '<div style="font-size:13px;color:' + colors.text + ';margin-bottom:12px">' + esc(desc) + '</div>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    for (var i = 0; i < Math.min(parts.length, fields.length); i++) {
      h += '<div style="text-align:center;padding:6px 10px;background:' + colors.bg + ';border-radius:6px;border:1px solid ' + colors.border + '">';
      h += '<div style="font-family:monospace;font-size:14px;font-weight:600;color:' + colors.text + '">' + esc(parts[i]) + '</div>';
      h += '<div style="font-size:10px;color:' + colors.textMuted + '">' + fields[i] + '</div>';
      h += '</div>';
    }
    h += '</div></div>';
    container.innerHTML = h;
  };

  // ─── Embed ───
  renderers.embed = function(container, data) {
    var url = typeof data === 'string' ? data : (data.url || data.src || data.href || '');
    var title = typeof data === 'object' ? (data.title || '') : '';
    // Convert YouTube watch URLs to embed URLs
    var embedUrl = url.replace(/youtube\\.com\\/watch\\?v=([^&]+)/, 'youtube.com/embed/$1')
                      .replace(/youtu\\.be\\/([^?]+)/, 'youtube.com/embed/$1');
    var h = '<div style="border-radius:8px;overflow:hidden;border:1px solid ' + colors.border + '">';
    h += '<iframe src="' + esc(embedUrl) + '" style="width:100%;aspect-ratio:16/9;border:none" allowfullscreen></iframe>';
    if (title) h += '<div style="padding:8px 12px;font-size:12px;color:' + colors.textMuted + ';background:' + colors.bgAlt + '">' + esc(title) + '</div>';
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Map (Leaflet) ───
  var _loadLeaflet = _makeLoader(
    'https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.min.js',
    'https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.min.css'
  );

  renderers.map = function(container, data) {
    var items = Array.isArray(data) ? data : [data];
    var mapId = '_map_' + Math.random().toString(36).slice(2, 8);
    container.innerHTML = '<div id="' + mapId + '" style="height:350px;border-radius:8px;overflow:hidden;border:1px solid ' + colors.border + '"></div>';
    _loadLeaflet(function() {
      if (!window.L) { container.innerHTML = '<p style="color:' + colors.textMuted + '">Failed to load map library</p>'; return; }
      var el = document.getElementById(mapId);
      if (!el) return;
      var map = L.map(el);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '\\u00A9 OpenStreetMap'
      }).addTo(map);
      var bounds = [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var lat = item.lat || item.latitude;
        var lng = item.lng || item.lon || item.longitude;
        if (lat == null || lng == null) continue;
        var label = item.label || item.name || item.title || '';
        var popup = item.popup || item.description || label;
        var marker = L.marker([lat, lng]).addTo(map);
        if (popup) marker.bindPopup(esc(popup));
        bounds.push([lat, lng]);
      }
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [30, 30] });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 13);
      } else {
        map.setView([0, 0], 2);
      }
    });
  };

  // ─── Calendar ───
  renderers.calendar = function(container, data) {
    var events = Array.isArray(data) ? data : (data.events || [data]);
    // Build month view for current month (or month of first event)
    var firstDate = null;
    for (var i = 0; i < events.length; i++) {
      var d = events[i].start || events[i].date || events[i].time;
      if (d) { firstDate = new Date(d); break; }
    }
    if (!firstDate) firstDate = new Date();
    var year = firstDate.getFullYear();
    var month = firstDate.getMonth();
    var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build event map: dateStr → events[]
    var eventMap = {};
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var ds = (ev.start || ev.date || ev.time || '').toString().slice(0, 10);
      if (!ds) continue;
      if (!eventMap[ds]) eventMap[ds] = [];
      eventMap[ds].push(ev);
    }

    // Calendar grid
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var today = new Date().toISOString().slice(0, 10);

    var h = '<div style="background:' + colors.bgAlt + ';border-radius:10px;padding:16px;border:1px solid ' + colors.border + '">';
    h += '<div style="text-align:center;font-size:16px;font-weight:700;color:' + colors.text + ';margin-bottom:12px">' + monthNames[month] + ' ' + year + '</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">';
    // Day headers
    for (var d = 0; d < 7; d++) {
      h += '<div style="font-size:10px;font-weight:600;color:' + colors.textMuted + ';padding:4px">' + dayNames[d] + '</div>';
    }
    // Empty cells before first day
    for (var e = 0; e < firstDay; e++) {
      h += '<div></div>';
    }
    // Day cells
    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var hasEvents = eventMap[dateStr];
      var isToday = dateStr === today;
      var cellBg = isToday ? colors.accent + '30' : 'transparent';
      var cellBorder = isToday ? '2px solid ' + colors.accent : '1px solid transparent';
      h += '<div style="padding:4px;border-radius:6px;background:' + cellBg + ';border:' + cellBorder + ';min-height:32px;cursor:' + (hasEvents ? 'pointer' : 'default') + '" title="' + (hasEvents ? hasEvents.map(function(e) { return e.title || e.name || ''; }).join(', ') : '') + '">';
      h += '<div style="font-size:12px;color:' + (isToday ? colors.accent : colors.text) + ';font-weight:' + (isToday ? '700' : '400') + '">' + day + '</div>';
      if (hasEvents) {
        for (var ei = 0; ei < Math.min(hasEvents.length, 2); ei++) {
          var evColor = hasEvents[ei].color || colors.accent;
          h += '<div style="font-size:8px;background:' + evColor + ';color:#fff;border-radius:3px;padding:1px 3px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(hasEvents[ei].title || hasEvents[ei].name || '') + '</div>';
        }
        if (hasEvents.length > 2) h += '<div style="font-size:8px;color:' + colors.textMuted + '">+' + (hasEvents.length - 2) + ' more</div>';
      }
      h += '</div>';
    }
    h += '</div>';

    // Upcoming events list
    var upcoming = [];
    for (var ds in eventMap) {
      for (var ui = 0; ui < eventMap[ds].length; ui++) {
        upcoming.push({ date: ds, event: eventMap[ds][ui] });
      }
    }
    upcoming.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
    if (upcoming.length > 0) {
      h += '<div style="margin-top:12px;border-top:1px solid ' + colors.border + ';padding-top:12px">';
      h += '<div style="font-size:11px;font-weight:600;color:' + colors.textMuted + ';margin-bottom:8px">UPCOMING</div>';
      for (var ui = 0; ui < Math.min(upcoming.length, 5); ui++) {
        var u = upcoming[ui];
        var title = u.event.title || u.event.name || '';
        var time = u.event.start || u.event.time || u.date;
        var evColor = u.event.color || colors.accent;
        h += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px">';
        h += '<div style="width:4px;height:4px;border-radius:50%;background:' + evColor + ';flex-shrink:0"></div>';
        h += '<span style="color:' + colors.textMuted + ';flex-shrink:0">' + esc(String(time).slice(0, 10)) + '</span>';
        h += '<span style="color:' + colors.text + '">' + esc(title) + '</span>';
        h += '</div>';
      }
      h += '</div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Network/Graph (force-directed via vis-network) ───
  var _loadVisNetwork = _makeLoader('https://cdn.jsdelivr.net/npm/vis-network@9/standalone/umd/vis-network.min.js');

  renderers.network = renderers.graph = function(container, data) {
    var nodes = data.nodes || [];
    var edges = data.edges || data.links || [];
    var netId = '_net_' + Math.random().toString(36).slice(2, 8);
    container.innerHTML = '<div id="' + netId + '" style="height:400px;border-radius:8px;overflow:hidden;border:1px solid ' + colors.border + ';background:' + colors.bgAlt + '"></div>';
    _loadVisNetwork(function() {
      if (!window.vis) { container.innerHTML = '<p style="color:' + colors.textMuted + '">Failed to load graph library</p>'; return; }
      var el = document.getElementById(netId);
      if (!el) return;
      // Map groups to colors
      var groupColors = {};
      var ci = 0;
      var visNodes = nodes.map(function(n) {
        var group = n.group || n.category || n.type || 'default';
        if (!groupColors[group]) groupColors[group] = colors.palette[ci++ % colors.palette.length];
        return {
          id: n.id || n.name,
          label: n.label || n.name || n.id || '',
          color: { background: groupColors[group], border: groupColors[group], highlight: { background: groupColors[group], border: colors.accent } },
          font: { color: colors.text, size: 12 },
          shape: 'dot',
          size: n.size || 16
        };
      });
      var visEdges = edges.map(function(e) {
        return {
          from: e.from || e.source,
          to: e.to || e.target,
          label: e.label || '',
          color: { color: colors.border, highlight: colors.accent },
          font: { color: colors.textMuted, size: 10, align: 'middle' },
          arrows: e.directed !== false ? 'to' : ''
        };
      });
      new vis.Network(el, { nodes: new vis.DataSet(visNodes), edges: new vis.DataSet(visEdges) }, {
        physics: { solver: 'forceAtlas2Based', forceAtlas2Based: { gravitationalConstant: -30 } },
        interaction: { hover: true, tooltipDelay: 200 }
      });
    });
  };

  // ── Checklist ──

  renderers.checklist = function(container, data, opts) {
    opts = opts || {};
    var items = Array.isArray(data) ? data : [];
    var hideCompleted = false;

    function textKey(item) {
      return item.text || item.title || item.name || item.task || item.label || '';
    }
    function isDone(item) {
      return !!(item.done || item.completed || item.checked);
    }

    // Sort: undone first, done last, preserve relative order within each group
    function sortItems(arr) {
      var undone = [], done = [];
      for (var i = 0; i < arr.length; i++) {
        if (isDone(arr[i])) done.push(arr[i]);
        else undone.push(arr[i]);
      }
      return undone.concat(done);
    }

    var checkSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6l2.5 2.5 4.5-5"/></svg>';
    var gripSvg = '<svg width="14" height="14" viewBox="0 0 16 16" fill="' + colors.textMuted + '"><circle cx="5" cy="4" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/></svg>';

    function render() {
      var undone = items.filter(function(i) { return !isDone(i); });
      var done = items.filter(isDone);
      var doneCount = done.length;
      var totalCount = items.length;
      var pct = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

      var h = '<div style="border-radius:8px;overflow:hidden;border:1px solid ' + colors.border + ';font-family:inherit;">';

      // Header
      h += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;font-size:12px;color:' + colors.textMuted + ';background:rgba(255,255,255,0.03);">';
      h += '<span style="font-weight:500;font-variant-numeric:tabular-nums;">' + doneCount + ' of ' + totalCount + ' done</span>';
      h += '<label class="checklist-hide-toggle" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">';
      h += '<input type="checkbox" ' + (hideCompleted ? 'checked' : '') + ' style="display:none;" />';
      h += '<span>' + (hideCompleted ? 'Show completed' : 'Hide completed') + '</span></label>';
      h += '</div>';

      // Progress bar
      h += '<div style="height:3px;background:rgba(255,255,255,0.03);"><div style="height:100%;width:' + pct + '%;background:' + colors.accent + ';transition:width 0.5s cubic-bezier(0.16,1,0.3,1);"></div></div>';

      // Undone items
      function renderItem(item, idx, opacity) {
        var isD = isDone(item);
        h += '<div class="checklist-item" draggable="true" data-idx="' + idx + '" style="';
        h += 'display:flex;align-items:center;gap:12px;padding:12px 16px;';
        h += 'cursor:grab;user-select:none;transition:opacity 0.3s,background 0.15s;';
        if (opacity) h += 'opacity:' + opacity + ';';
        h += '">';
        // Grip
        h += '<span class="grip" style="opacity:0;transition:opacity 0.15s;">' + gripSvg + '</span>';
        // Custom checkbox
        var cbBg = isD ? colors.accent : 'transparent';
        var cbBorder = isD ? colors.accent : colors.textMuted;
        h += '<div class="checklist-cb" data-idx="' + idx + '" style="width:20px;height:20px;border-radius:6px;border:2px solid ' + cbBorder + ';background:' + cbBg + ';display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:all 0.2s;">';
        if (isD) h += checkSvg;
        h += '</div>';
        // Text
        h += '<span style="flex:1;font-size:14px;color:' + (isD ? colors.textMuted : colors.text) + ';';
        if (isD) h += 'text-decoration:line-through;text-decoration-color:' + colors.textMuted + ';';
        h += '">' + esc(textKey(item)) + '</span>';
        h += '</div>';
      }

      for (var u = 0; u < undone.length; u++) renderItem(undone[u], items.indexOf(undone[u]), null);

      // Separator
      if (doneCount > 0 && !hideCompleted) {
        h += '<div style="padding:8px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:' + colors.textMuted + ';background:rgba(255,255,255,0.03);display:flex;align-items:center;gap:10px;border-top:1px solid ' + colors.border + ';">';
        h += '<span style="width:4px;height:4px;border-radius:50%;background:' + colors.textMuted + ';opacity:0.5;"></span>';
        h += 'Completed' + (doneCount < totalCount ? ' (' + doneCount + ')' : '');
        h += '<span style="flex:1;height:1px;background:' + colors.border + ';"></span></div>';
      }

      // Done items
      if (!hideCompleted) {
        for (var d = 0; d < done.length; d++) renderItem(done[d], items.indexOf(done[d]), '0.7');
      }

      // All done message
      if (hideCompleted && doneCount === totalCount && totalCount > 0) {
        h += '<div style="padding:32px 16px;text-align:center;color:' + colors.textMuted + ';font-size:14px;">';
        h += '<div style="font-size:28px;margin-bottom:8px;opacity:0.6;">&#10003;</div>';
        h += 'All ' + totalCount + ' items completed</div>';
      }

      if (items.length === 0) {
        h += '<div style="padding:24px;text-align:center;color:' + colors.textMuted + ';font-size:14px;">No items</div>';
      }

      h += '</div>';
      container.innerHTML = h;

      // Bind custom checkbox click
      var cbs = container.querySelectorAll('.checklist-cb');
      for (var c = 0; c < cbs.length; c++) {
        cbs[c].addEventListener('click', function(e) {
          var idx = parseInt(e.currentTarget.getAttribute('data-idx'));
          var item = items[idx];
          if (!item) return;
          if ('done' in item) item.done = !item.done;
          else if ('completed' in item) item.completed = !item.completed;
          else if ('checked' in item) item.checked = !item.checked;
          else item.done = true;
          if (window.photon && window.photon.callTool) {
            window.photon.callTool('check', { text: textKey(item), done: isDone(item) }).catch(function(){});
          }
          render();
        });
      }

      // Bind hide toggle
      var toggle = container.querySelector('.checklist-hide-toggle');
      if (toggle) {
        toggle.addEventListener('click', function() {
          hideCompleted = !hideCompleted;
          render();
        });
      }

      // Show grip on item hover
      var allItems = container.querySelectorAll('.checklist-item');
      for (var g = 0; g < allItems.length; g++) {
        (function(el) {
          var grip = el.querySelector('.grip');
          if (grip) {
            el.addEventListener('mouseenter', function() { grip.style.opacity = '0.4'; });
            el.addEventListener('mouseleave', function() { grip.style.opacity = '0'; });
          }
        })(allItems[g]);
      }

      // Drag-and-drop reorder
      var dragIdx = null;
      var itemEls = container.querySelectorAll('.checklist-item');
      for (var d = 0; d < itemEls.length; d++) {
        (function(el) {
          el.addEventListener('dragstart', function(e) {
            dragIdx = parseInt(el.getAttribute('data-idx'));
            requestAnimationFrame(function() {
              el.style.opacity = '0.3';
              el.style.transform = 'scale(0.98)';
            });
            e.dataTransfer.effectAllowed = 'move';
          });
          el.addEventListener('dragend', function() {
            el.style.opacity = isDone(items[parseInt(el.getAttribute('data-idx'))]) ? '0.5' : '1';
            el.style.transform = '';
            dragIdx = null;
          });
          el.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.style.background = colors.bgAlt;
            el.style.boxShadow = 'inset 0 -2px 0 ' + colors.accent;
          });
          el.addEventListener('dragleave', function() {
            el.style.background = '';
            el.style.boxShadow = '';
          });
          el.addEventListener('drop', function(e) {
            e.preventDefault();
            el.style.background = '';
            el.style.boxShadow = '';
            var dropIdx = parseInt(el.getAttribute('data-idx'));
            if (dragIdx !== null && dragIdx !== dropIdx) {
              var moved = items.splice(dragIdx, 1)[0];
              items.splice(dropIdx, 0, moved);
              // Callback to photon if available
              if (window.photon && window.photon.callTool) {
                var order = items.map(function(it) { return textKey(it); });
                window.photon.callTool('reorder', { order: order }).catch(function(){});
              }
              render();
            }
          });
        })(itemEls[d]);
      }
    }

    render();
  };

  // ─── Ring ───
  renderers.ring = function(container, data, opts) {
    opts = opts || {};
    var value = typeof data === 'number' ? data : (data.value || 0);
    var label = opts.label || data.label || '';
    var variant = opts.variant || data.variant || 'info';
    var max = opts.max != null ? opts.max : (data.max || 100);
    var pct = Math.max(0, Math.min(100, (value / max) * 100));
    var size = opts.size || 120;
    var thickness = opts.thickness || 12;
    var r = (size - thickness) / 2;
    var cx = size / 2, cy = size / 2;
    var c = 2 * Math.PI * r;
    var offset = c - (pct / 100) * c;
    
    var ringColor = VARIANT_COLORS[variant] || VARIANT_COLORS.info;

    var h = '<div style="position:relative;width:' + size + 'px;height:' + size + 'px;margin:0 auto">';
    h += '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="transform:rotate(-90deg)">';
    h += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="transparent" stroke="' + colors.bgAlt + '" stroke-width="' + thickness + '" />';
    if (pct > 0) {
      h += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="transparent" stroke="' + ringColor + '" stroke-width="' + thickness + '" stroke-dasharray="' + c + '" stroke-dashoffset="' + offset + '" stroke-linecap="round" style="transition:stroke-dashoffset 0.5s ease" />';
    }
    h += '</svg>';
    h += '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:' + colors.text + '">';
    h += '<span style="font-size:' + (size * 0.22) + 'px;font-weight:700">' + formatValue(value) + '</span>';
    if (label) h += '<span style="font-size:11px;color:' + colors.textMuted + ';margin-top:2px">' + esc(label) + '</span>';
    h += '</div></div>';
    container.innerHTML = h;
  };

  // ─── Alert ───
  renderers.alert = function(container, data, opts) {
    opts = opts || {};
    var d = typeof data === 'string' ? { description: data } : data;
    var title = d.title || d.heading || '';
    var desc = d.description || d.text || d.message || '';
    var variant = (opts.variant || d.variant || 'info').toLowerCase();
    var icon = d.icon || '';
    var ac = VARIANT_COLORS[variant] || VARIANT_COLORS.info;
    var bg = ac + '15'; 
    
    var h = '<div style="display:flex;gap:12px;padding:16px;background:' + bg + ';border:1px solid ' + ac + '40;border-radius:8px">';
    if (icon) {
      h += '<div style="flex-shrink:0;font-size:20px;color:' + ac + '">' + esc(icon) + '</div>';
    }
    h += '<div>';
    if (title) h += '<div style="font-weight:600;font-size:14px;color:' + colors.text + ';margin-bottom:4px">' + esc(title) + '</div>';
    if (desc) h += '<div style="font-size:13px;color:' + colors.textMuted + ';line-height:1.5">' + esc(desc) + '</div>';
    h += '</div></div>';
    container.innerHTML = h;
  };

  // ─── Sparkline ───
  renderers.sparkline = function(container, data, opts) {
    opts = opts || {};
    var items = Array.isArray(data) ? data : (data.data || []);
    if (!items.length) { container.innerHTML = ''; return; }
    
    var variant = opts.variant || data.variant || 'info';
    var color = VARIANT_COLORS[variant] || VARIANT_COLORS.info;
    
    var w = container.clientWidth || 100;
    var h = opts.height || data.height || 40;
    var min = Math.min.apply(null, items);
    var max = Math.max.apply(null, items);
    var range = max - min || 1;
    
    var points = items.map(function(val, i) {
      var x = i === 0 ? 0 : i === items.length - 1 ? w : (i / (items.length - 1)) * w;
      var y = h - ((val - min) / range) * h;
      return x + ',' + y;
    }).join(' ');
    
    var fill = opts.fill != null ? opts.fill : data.fill;
    
    var svg = '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">';
    if (fill) {
      svg += '<polygon points="0,' + h + ' ' + points + ' ' + w + ',' + h + '" fill="' + color + '33" />';
    }
    svg += '<polyline points="' + points + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />';
    svg += '</svg>';
    
    container.innerHTML = svg;
  };

  // ─── Empty State ───
  renderers['empty-state'] = renderers.empty = function(container, data) {
    var d = typeof data === 'string' ? { title: data } : (data || {});
    var title = d.title || d.heading || d.message || 'No Data';
    var desc = d.description || d.text || d.detail || '';
    var icon = d.icon || '\\u2205'; 
    var action = d.action || d.button || '';
    
    var h = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;background:' + colors.bgAlt + ';border:1px dashed ' + colors.border + ';border-radius:12px">';
    h += '<div style="font-size:32px;color:' + colors.textMuted + ';margin-bottom:16px;opacity:0.5">' + esc(icon) + '</div>';
    h += '<div style="font-size:16px;font-weight:600;color:' + colors.text + ';margin-bottom:4px">' + esc(title) + '</div>';
    if (desc) h += '<div style="font-size:13px;color:' + colors.textMuted + ';max-width:300px;margin:0 auto 16px">' + esc(desc) + '</div>';
    if (action) h += '<button style="background:' + colors.accent + ';color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer">' + esc(action) + '</button>';
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Accordion ───
  renderers.accordion = renderers.collapse = function(container, data) {
    var items = Array.isArray(data) ? data : (data.items || []);
    if (!items.length) { container.innerHTML = ''; return; }
    
    var h = '<div style="border-radius:8px;overflow:hidden;border:1px solid ' + colors.border + '">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var title = item.title || item.label || item.question || ('Item ' + (i + 1));
      var content = item.content || item.answer || item.body || item.details || '';
      var isOpen = !!item.open || !!item.expanded;
      
      h += '<div style="border-bottom:' + (i < items.length - 1 ? '1px solid ' + colors.border : 'none') + '">';
      h += '<div class="_acc_trigger" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:' + colors.bgAlt + ';cursor:pointer;font-size:14px;font-weight:600;color:' + colors.text + ';user-select:none">';
      h += '<span>' + esc(title) + '</span>';
      h += '<span class="_acc_icon" style="transform:' + (isOpen ? 'rotate(180deg)' : 'rotate(0)') + ';transition:transform 0.2s ease;color:' + colors.textMuted + '">\\u25BC</span>';
      h += '</div>';
      h += '<div class="_acc_content" style="display:' + (isOpen ? 'block' : 'none') + ';padding:16px;font-size:13px;color:' + colors.textMuted + ';background:' + colors.bg + ';border-top:1px solid ' + colors.border + '">';
      h += (typeof content === 'string' ? esc(content).replace(/\\n/g, '<br>') : '<pre style="margin:0;font-family:monospace;font-size:12px">' + esc(JSON.stringify(content, null, 2)) + '</pre>');
      h += '</div></div>';
    }
    h += '</div>';
    container.innerHTML = h;
    
    var triggers = container.querySelectorAll('._acc_trigger');
    for (var j = 0; j < triggers.length; j++) {
      triggers[j].onclick = function(e) {
        var t = e.currentTarget;
        var c = t.nextElementSibling;
        var icon = t.querySelector('._acc_icon');
        var isHidden = c.style.display === 'none';
        c.style.display = isHidden ? 'block' : 'none';
        icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0)';
      };
    }
  };

  // ─── Feed (Activity Stream) ───
  renderers.feed = renderers.activity = function(container, data) {
    var items = Array.isArray(data) ? data : (data.items || []);
    if (!items.length) { container.innerHTML = ''; return; }
    
    var h = '<div style="display:flex;flex-direction:column;gap:16px">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var user = item.user || item.author || item.name || 'System';
      var action = item.action || item.event || 'performed an action';
      var target = item.target || item.object || '';
      var ts = item.timestamp || item.time || item.date || '';
      var avatar = item.avatar || item.image || '';
      var details = item.details || item.message || item.body || '';
      
      h += '<div style="display:flex;gap:12px">';
      // Avatar
      if (avatar) {
        h += '<img src="' + esc(avatar) + '" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;border:1px solid ' + colors.border + '" />';
      } else {
        h += '<div style="width:32px;height:32px;border-radius:50%;background:' + colors.bgAlt + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:600;color:' + colors.text + ';font-size:12px;border:1px solid ' + colors.border + '">' + esc(user.charAt(0).toUpperCase()) + '</div>';
      }
      // Content
      h += '<div style="flex:1;min-width:0">';
      h += '<div style="font-size:13px;color:' + colors.text + ';margin-bottom:2px">';
      h += '<span style="font-weight:600">' + esc(user) + '</span> ';
      h += '<span style="color:' + colors.textMuted + '">' + esc(action) + '</span> ';
      if (target) h += '<span style="font-weight:500">' + esc(target) + '</span>';
      h += '</div>';
      if (ts) h += '<div style="font-size:11px;color:' + colors.textMuted + ';margin-bottom:4px">' + esc(_formatDate(ts)) + '</div>';
      if (details) {
        h += '<div style="background:' + colors.bgAlt + ';border:1px solid ' + colors.border + ';border-radius:8px;padding:8px 12px;font-size:13px;color:' + colors.textMuted + ';margin-top:6px">';
        h += (typeof details === 'string' ? esc(details).replace(/\\n/g, '<br>') : '<pre style="margin:0;font-size:11px">' + esc(JSON.stringify(details, null, 2)) + '</pre>');
        h += '</div>';
      }
      h += '</div></div>';
    }
    h += '</div>';
    container.innerHTML = h;
  };

  // ─── Tabs ───
  renderers.tabs = function(container, data) {
    var items = Array.isArray(data) ? data : (data.items || data.tabs || []);
    if (!Array.isArray(data) && typeof data === 'object' && !data.items && !data.tabs) {
      items = Object.keys(data).map(function(k) { return { title: k, content: data[k] }; });
    }
    if (!items.length) { container.innerHTML = ''; return; }
    
    var navId = '_tabs_' + Math.random().toString(36).slice(2, 8);
    var h = '<div id="' + navId + '">';
    h += '<div style="display:flex;gap:24px;border-bottom:1px solid ' + colors.border + ';margin-bottom:16px;overflow-x:auto">';
    for (var i = 0; i < items.length; i++) {
        var title = items[i].title || items[i].label || items[i].name || ('Tab ' + (i+1));
        var isActive = i === 0;
        h += '<div class="_tab_trigger" data-idx="' + i + '" style="padding:8px 4px;font-size:13px;font-weight:600;cursor:pointer;user-select:none;white-space:nowrap;border-bottom:2px solid ' + (isActive ? colors.accent : 'transparent') + ';color:' + (isActive ? colors.accent : colors.textMuted) + ';transition:all 0.2s">' + esc(title) + '</div>';
    }
    h += '</div>';
    h += '<div class="_tab_panels">';
    for (var j = 0; j < items.length; j++) {
        var c = items[j].content || items[j].body || items[j].data || items[j];
        var isJSON = typeof c === 'object';
        h += '<div class="_tab_panel" data-idx="' + j + '" style="display:' + (j === 0 ? 'block' : 'none') + '">';
        if (!isJSON) {
          h += '<div style="font-size:13px;color:' + colors.text + ';line-height:1.5">' + esc(String(c)).replace(/\\n/g, '<br>') + '</div>';
        } else {
          h += '<pre style="font-size:12px;background:' + colors.bgAlt + ';padding:12px;border-radius:6px;color:' + colors.text + ';overflow:auto;max-height:400px;margin:0">' + esc(JSON.stringify(c, null, 2)) + '</pre>';
        }
        h += '</div>';
    }
    h += '</div></div>';
    container.innerHTML = h;
    
    var root = document.getElementById(navId);
    if (!root) return;
    var triggers = root.querySelectorAll('._tab_trigger');
    var panels = root.querySelectorAll('._tab_panel');
    var switchTab = function(idx) {
        for (var k = 0; k < triggers.length; k++) {
            var isActive = (k === idx);
            triggers[k].style.borderBottomColor = isActive ? colors.accent : 'transparent';
            triggers[k].style.color = isActive ? colors.accent : colors.textMuted;
            panels[k].style.display = isActive ? 'block' : 'none';
        }
    };
    for (var l = 0; l < triggers.length; l++) {
        triggers[l].onclick = function(e) {
            switchTab(parseInt(e.currentTarget.getAttribute('data-idx')));
        };
    }
  };

  // ─── Tree ───
  renderers.tree = function(container, data) {
    if (!data) { container.innerHTML = ''; return; }
    
    var uid = 0;
    function renderNode(node, label, depth) {
      if (node == null) return '';
      uid++;
      var isObj = typeof node === 'object';
      var isArr = Array.isArray(node);
      var isEmpty = isObj && Object.keys(node).length === 0;
      var h = '<div style="margin-left:' + (depth > 0 ? 16 : 0) + 'px;font-size:13px;font-family:inherit;line-height:1.8">';
      if (!isObj || isEmpty) {
         h += '<span style="color:' + colors.textMuted + '">';
         if (label !== null) h += esc(label) + ': ';
         h += '</span>';
         if (isEmpty) h += '<span style="color:' + colors.textMuted + ';font-style:italic">' + (isArr ? '[]' : '{}') + '</span>';
         else {
             var valColor = typeof node === 'number' ? '#ff9e64' : typeof node === 'string' ? '#a5d6ff' : typeof node === 'boolean' ? '#ff7b72' : colors.text;
             h += '<span style="color:' + valColor + '">' + formatValue(node) + '</span>';
         }
      } else {
         var _id = '_tree_' + uid;
         h += '<div style="display:flex;align-items:center;cursor:pointer;user-select:none" onclick="var e=document.getElementById(\\''+_id+'\\');var s=e.style.display===\\'none\\';e.style.display=s?\\'block\\':\\'none\\';this.children[0].style.transform=s?\\'rotate(90deg)\\':\\'rotate(0deg)\\';">';
         h += '<span style="display:inline-block;width:12px;text-align:center;font-size:10px;color:' + colors.textMuted + ';transform:rotate(90deg);transition:transform 0.1s;margin-right:4px">\\u25B6</span>'; 
         if (label !== null) h += '<span style="font-weight:600;color:' + colors.text + '">' + esc(label) + '</span>';
         h += '<span style="color:' + colors.textMuted + ';font-size:11px;margin-left:6px">' + (isArr ? '[' + node.length + ']' : '{...}') + '</span>';
         h += '</div>';
         
         h += '<div id="' + _id + '">';
         if (isArr) {
            for (var i = 0; i < node.length; i++) h += renderNode(node[i], i, depth + 1);
         } else {
            for (var k in node) h += renderNode(node[k], k, depth + 1);
         }
         h += '</div>';
      }
      h += '</div>';
      return h;
    }
    
    container.innerHTML = '<div style="background:' + colors.bgAlt + ';padding:12px;border-radius:8px;border:1px solid ' + colors.border + ';overflow:auto;max-height:500px">' + renderNode(data, null, 0) + '</div>';
  };

  // ─── DataTable (Searchable + Paginated) ───
  renderers.datatable = function(container, data, opts) {
    opts = opts || {};
    var rows = Array.isArray(data) ? data : (data.rows || data.items || data.data || [data]);
    if (!rows.length) { renderers.table(container, rows, opts); return; }
    
    var cols = Object.keys(rows[0]).filter(function(k) { return typeof rows[0][k] !== 'function'; });
    if (opts.columns) cols = opts.columns;
    
    var sortCol = null, sortDir = 1;
    var query = '';
    var page = 0;
    var pageSize = opts.pageSize || 10;
    
    var wrapperId = '_dt_' + Math.random().toString(36).slice(2, 8);
    var h = '<div id="' + wrapperId + '">';
    h += '<div style="display:flex;justify-content:space-between;margin-bottom:12px;align-items:center">';
    h += '<input type="search" placeholder="Search..." class="_dt_search" style="padding:6px 12px;border-radius:6px;border:1px solid ' + colors.border + ';background:' + colors.bgAlt + ';color:' + colors.text + ';font-size:13px;width:200px" />';
    h += '<div class="_dt_info" style="font-size:12px;color:' + colors.textMuted + '"></div>';
    h += '</div>';
    h += '<div style="overflow-x:auto;border:1px solid ' + colors.border + ';border-radius:8px">';
    h += '<table style="width:100%;border-collapse:collapse;font-size:13px;color:' + colors.text + '">';
    h += '<thead><tr style="background:' + colors.bgAlt + '">';
    for (var i = 0; i < cols.length; i++) {
        h += '<th data-col="' + esc(cols[i]) + '" style="cursor:pointer;text-align:left;padding:10px 12px;border-bottom:2px solid ' + colors.border + ';font-weight:600;white-space:nowrap;color:' + colors.textMuted + ';font-size:12px;user-select:none">';
        h += esc(formatLabel(cols[i])) + '<span class="_dt_sort" style="margin-left:4px;font-size:10px"></span></th>';
    }
    h += '</tr></thead><tbody class="_dt_body"></tbody></table></div>';
    
    h += '<div style="display:flex;justify-content:flex-end;margin-top:12px;align-items:center;gap:12px">';
    h += '<button class="_dt_prev" style="padding:4px 10px;background:' + colors.bgAlt + ';border:1px solid ' + colors.border + ';border-radius:4px;color:' + colors.text + ';cursor:pointer;font-size:12px" disabled>&larr; Prev</button>';
    h += '<span class="_dt_pageStr" style="font-size:12px;color:' + colors.textMuted + '"></span>';
    h += '<button class="_dt_next" style="padding:4px 10px;background:' + colors.bgAlt + ';border:1px solid ' + colors.border + ';border-radius:4px;color:' + colors.text + ';cursor:pointer;font-size:12px">Next &rarr;</button>';
    h += '</div></div>';
    container.innerHTML = h;
    
    var root = document.getElementById(wrapperId);
    var searchEl = root.querySelector('._dt_search');
    var bodyEl = root.querySelector('._dt_body');
    var infoEl = root.querySelector('._dt_info');
    var prevEl = root.querySelector('._dt_prev');
    var nextEl = root.querySelector('._dt_next');
    var pageStrEl = root.querySelector('._dt_pageStr');
    var ths = root.querySelectorAll('thead th');
    
    function renderView() {
        var filtered = rows;
        if (query) {
            var q = query.toLowerCase();
            filtered = rows.filter(function(r) {
                for (var c=0; c<cols.length; c++) {
                    var v = r[cols[c]];
                    if (v != null && String(v).toLowerCase().indexOf(q) !== -1) return true;
                }
                return false;
            });
        }
        if (sortCol) {
            filtered.sort(function(a,b) {
                var va = a[sortCol], vb = b[sortCol];
                if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sortDir;
                return String(va || '').localeCompare(String(vb || '')) * sortDir;
            });
        }
        
        var totalPages = Math.ceil(filtered.length / pageSize) || 1;
        if (page >= totalPages) page = totalPages - 1;
        if (page < 0) page = 0;
        var start = page * pageSize;
        var viewRows = filtered.slice(start, start + pageSize);
        
        var bh = '';
        for (var r=0; r<viewRows.length; r++) {
            bh += '<tr style="border-bottom:1px solid ' + colors.border + ';background:' + (r%2===0 ? colors.bg : 'rgba(0,0,0,0.02)') + '">';
            for(var c=0; c<cols.length; c++) {
               bh += '<td style="padding:8px 12px">' + formatValue(viewRows[r][cols[c]]) + '</td>';
            }
            bh += '</tr>';
        }
        if (!viewRows.length) bh = '<tr><td colspan="' + cols.length + '" style="padding:20px;text-align:center;color:' + colors.textMuted + '">No matching records found.</td></tr>';
        bodyEl.innerHTML = bh;
        
        infoEl.textContent = filtered.length + ' entries';
        pageStrEl.textContent = 'Page ' + (page+1) + ' of ' + totalPages;
        prevEl.disabled = page === 0;
        nextEl.disabled = page >= totalPages - 1;
        prevEl.style.opacity = prevEl.disabled ? '0.5' : '1';
        nextEl.style.opacity = nextEl.disabled ? '0.5' : '1';
        
        for (var l=0; l<ths.length; l++) {
            var arrow = ths[l].getAttribute('data-col') === sortCol ? (sortDir===1 ? '\\u25B2' : '\\u25BC') : '';
            ths[l].querySelector('._dt_sort').textContent = arrow;
        }
    }
    
    searchEl.oninput = function(e) { query = e.target.value; page = 0; renderView(); };
    prevEl.onclick = function() { if (page > 0) { page--; renderView(); } };
    nextEl.onclick = function() { page++; renderView(); };
    for (var lh=0; lh<ths.length; lh++) {
        ths[lh].onclick = function(e) {
            var col = e.currentTarget.getAttribute('data-col');
            if (sortCol === col) sortDir *= -1; else { sortCol = col; sortDir = 1; }
            renderView();
        }
    }
    
    renderView();
  };

  // ── Public API ──

  window._photonRenderers = {
    render: function(container, data, format, opts) {
      if (!container) return;
      // Refresh colors from CSS vars on every render so theme changes are reflected
      colors = getColors();
      VARIANT_COLORS.info = colors.accent;
      VARIANT_COLORS.neutral = colors.textMuted;
      format = format || 'json';
      var key = format.toLowerCase();
      // Try exact match, then prefix match (chart:bar → chart)
      var fn = renderers[key] || renderers[key.split(':')[0]];
      if (!fn) { renderers.json(container, data); return; }
      fn(container, data, opts, key);
    },
    formats: Object.keys(renderers)
  };
})();`;
}

/**
 * Format catalog — format name → expected data shape.
 * Used by AI to generate valid canvas data for each slot format.
 *
 * Usage:
 *   import { FORMAT_CATALOG, SUPPORTED_FORMATS } from './renderers.js';
 */
export interface FormatSpec {
  data: string; // TypeScript-style data shape description
  example: unknown; // Minimal working example
}

export const FORMAT_CATALOG: Record<string, FormatSpec> = {
  // ── Data Display ──
  table: {
    data: 'Array<object>',
    example: [
      { name: 'Alice', role: 'Eng' },
      { name: 'Bob', role: 'PM' },
    ],
  },
  list: {
    data: 'Array<{ name, subtitle?, status?, badge? }>',
    example: [{ name: 'Task 1', subtitle: 'In progress', status: 'active' }],
  },
  card: {
    data: '{ key: value, ... }',
    example: { name: 'Server-1', status: 'healthy', uptime: '99.9%' },
  },
  kv: { data: '{ key: value, ... }', example: { host: 'prod-01', region: 'us-east', cpu: '42%' } },
  json: { data: 'any', example: { debug: true, nested: { key: 'value' } } },
  text: { data: 'string', example: 'Hello world' },
  markdown: { data: 'string (markdown)', example: '# Title\n\nSome **bold** text' },
  code: {
    data: 'string | { code, language? }',
    example: { code: 'console.log("hi")', language: 'javascript' },
  },
  metric: {
    data: '{ value, trend?, period?, label? }',
    example: { value: '$142K', trend: '+12%', period: 'this month' },
  },
  gauge: {
    data: '{ value, max?, min?, label?, unit? }',
    example: { value: 73, max: 100, label: 'CPU', unit: '%' },
  },
  progress: {
    data: '{ value, max?, label? } (value 0-1 or 0-100)',
    example: { value: 0.65, label: 'Upload' },
  },
  badge: { data: 'string', example: 'active' },
  chips: { data: 'Array<string>', example: ['React', 'TypeScript', 'Node.js'] },

  // ── Charts ──
  'chart:bar': {
    data: 'Array<{ label, value }>',
    example: [
      { month: 'Jan', revenue: 42000 },
      { month: 'Feb', revenue: 48000 },
    ],
  },
  'chart:hbar': {
    data: 'Array<{ label, value }>',
    example: [
      { lang: 'TypeScript', stars: 95000 },
      { lang: 'Rust', stars: 87000 },
    ],
  },
  'chart:line': {
    data: 'Array<{ x, y }>',
    example: [
      { date: 'Mon', requests: 1200 },
      { date: 'Tue', requests: 1500 },
    ],
  },
  'chart:pie': {
    data: 'Array<{ label, value }>',
    example: [
      { source: 'Organic', users: 4500 },
      { source: 'Paid', users: 2100 },
    ],
  },
  'chart:area': {
    data: 'Array<{ x, y }>',
    example: [
      { time: '9am', load: 0.4 },
      { time: '12pm', load: 0.8 },
    ],
  },
  'chart:donut': {
    data: 'Array<{ label, value }>',
    example: [
      { status: 'Pass', count: 42 },
      { status: 'Fail', count: 3 },
    ],
  },
  'chart:radar': {
    data: 'Array<{ axis, value }>',
    example: [
      { skill: 'Frontend', level: 8 },
      { skill: 'Backend', level: 9 },
    ],
  },
  sparkline: { data: 'Array<number>', example: [10, 25, 18, 30, 22, 35, 28] },
  ring: { data: '{ value, max?, label? }', example: { value: 75, max: 100, label: 'Progress' } },

  // ── Composite Layouts ──
  tabs: {
    data: 'Array<{ title, content }> | { tabName: content }',
    example: [
      { title: 'Overview', content: 'Main info here' },
      { title: 'Details', content: 'Extra details' },
    ],
  },
  accordion: {
    data: 'Array<{ title, content }>',
    example: [
      { title: 'FAQ 1', content: 'Answer 1' },
      { title: 'FAQ 2', content: 'Answer 2' },
    ],
  },

  // ── Timeline & Steps ──
  timeline: {
    data: 'Array<{ time, event, details? }>',
    example: [
      { time: '10:00', event: 'Deploy started' },
      { time: '10:05', event: 'Tests passed' },
    ],
  },
  steps: {
    data: 'Array<{ label, status? }>',
    example: [
      { label: 'Build', status: 'complete' },
      { label: 'Test', status: 'active' },
      { label: 'Deploy', status: 'pending' },
    ],
  },
  checklist: {
    data: 'Array<{ name|title, done|completed|checked }>',
    example: [
      { name: 'Write tests', done: true },
      { name: 'Deploy', done: false },
    ],
  },

  // ── Cards & Content ──
  'stat-group': {
    data: 'Array<{ label, value, change? }>',
    example: [
      { label: 'Revenue', value: '$42K', change: '+12%' },
      { label: 'Users', value: '1.2K' },
    ],
  },
  'feature-grid': {
    data: 'Array<{ icon, title, description }>',
    example: [{ icon: '🚀', title: 'Fast', description: 'Sub-ms response times' }],
  },
  profile: {
    data: '{ name, avatar?, role?, bio?, stats? }',
    example: { name: 'Jane', role: 'Engineer', bio: 'Full-stack dev', stats: { commits: 847 } },
  },
  quote: {
    data: '{ text, author?, source? }',
    example: { text: 'Ship it.', author: 'Reid Hoffman' },
  },
  hero: {
    data: '{ title, subtitle?, image?, cta? }',
    example: { title: 'Welcome', subtitle: 'Get started in seconds' },
  },
  banner: {
    data: '{ title, description?, variant? }',
    example: { title: 'New release', description: 'v2.0 is here', variant: 'info' },
  },
  alert: {
    data: '{ title?, description, variant?, icon? }',
    example: { description: 'Deployment complete', variant: 'success' },
  },

  // ── Media ──
  image: {
    data: '{ url, alt?, caption? } | string (url)',
    example: { url: 'https://example.com/photo.jpg', alt: 'Screenshot' },
  },
  carousel: {
    data: 'Array<{ url, caption? }>',
    example: [{ url: 'https://example.com/1.jpg' }, { url: 'https://example.com/2.jpg' }],
  },
  gallery: {
    data: 'Array<{ url, caption? }>',
    example: [{ url: 'https://example.com/1.jpg', caption: 'Photo 1' }],
  },
  qr: { data: 'string (url or text)', example: 'https://example.com' },
  embed: { data: '{ url, type? }', example: { url: 'https://youtube.com/embed/xxx' } },

  // ── Structured ──
  invoice: {
    data: '{ items: Array<{ name, qty, price }>, total?, tax? }',
    example: { items: [{ name: 'Widget', qty: 2, price: 9.99 }], total: 19.98 },
  },
  comparison: {
    data: 'Array<{ name, ...features }>',
    example: [
      { name: 'Plan A', price: '$10', storage: '10GB' },
      { name: 'Plan B', price: '$20', storage: '50GB' },
    ],
  },
  diff: {
    data: '{ before, after } | string (unified diff)',
    example: { before: 'old text', after: 'new text' },
  },
  log: {
    data: 'Array<{ timestamp?, level?, message }>',
    example: [{ timestamp: '10:00:01', level: 'info', message: 'Started' }],
  },
  kanban: {
    data: '{ columns: Array<{ title, items: Array<{ title, description? }> }> }',
    example: {
      columns: [
        { title: 'Todo', items: [{ title: 'Task 1' }] },
        { title: 'Done', items: [] },
      ],
    },
  },
  heatmap: {
    data: 'Array<Array<number>> | { rows, cols, values }',
    example: [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ],
  },
  calendar: {
    data: 'Array<{ date, title, color? }>',
    example: [
      { date: '2026-04-10', title: 'Launch' },
      { date: '2026-04-15', title: 'Review' },
    ],
  },
  network: {
    data: '{ nodes: Array<{ id, label? }>, edges: Array<{ from, to }> }',
    example: {
      nodes: [
        { id: 'a', label: 'API' },
        { id: 'b', label: 'DB' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    },
  },
  tree: {
    data: 'object (nested) | Array',
    example: { src: { components: { 'App.tsx': null }, utils: { 'helper.ts': null } } },
  },
  datatable: {
    data: 'Array<object> (with search/sort/pagination)',
    example: [
      { id: 1, name: 'Item A', price: 10 },
      { id: 2, name: 'Item B', price: 20 },
    ],
  },
  feed: {
    data: 'Array<{ user, action, target?, timestamp? }>',
    example: [{ user: 'Alice', action: 'deployed', target: 'prod', timestamp: '2m ago' }],
  },
  'empty-state': {
    data: '{ title?, description?, icon? }',
    example: { title: 'No results', description: 'Try a different query', icon: '🔍' },
  },

  // ── Declarative UI (A2UI v0.9 draft) ──
  a2ui: {
    data: 'Array<A2UIMessage> | { __a2ui: true, components, data }',
    example: [
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's-1',
          catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's-1',
          components: [{ id: 'root', component: 'Text', text: 'Hello' }],
        },
      },
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: 's-1', path: '/', value: {} },
      },
    ],
  },
};

/** Flat list of supported format names */
export const SUPPORTED_FORMATS: string[] = Object.keys(FORMAT_CATALOG);
