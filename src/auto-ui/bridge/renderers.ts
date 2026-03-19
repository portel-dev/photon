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
    var text = typeof data === 'string' ? data : (data.status || data.label || data.text || data.value || JSON.stringify(data));
    var variant = opts.variant || _badgeVariant(text);
    var badgeColors = {
      success: { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
      error:   { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
      warning: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24' },
      info:    { bg: 'rgba(108,158,255,0.15)', text: '#6c9eff' },
      neutral: { bg: colors.bgAlt, text: colors.textMuted }
    };
    var c = badgeColors[variant] || badgeColors.neutral;
    container.innerHTML = '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:500;background:' + c.bg + ';color:' + c.text + '">' + esc(text) + '</span>';
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
  renderers['chart'] = renderers['chart:bar'] = renderers['chart:hbar'] = renderers['chart:line'] = renderers['chart:pie'] = renderers['chart:area'] = renderers['chart:donut'] = function(container, data, opts, formatKey) {
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

      new Chart(canvas, {
        type: chartType,
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: true,
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
  var _qrLoading = false, _qrLoaded = false, _qrQueue = [];
  function _loadQRJS(cb) {
    if (_qrLoaded) { cb(); return; }
    _qrQueue.push(cb);
    if (_qrLoading) return;
    _qrLoading = true;
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js';
    s.onload = function() { _qrLoaded = true; _qrQueue.forEach(function(fn) { fn(); }); _qrQueue = []; };
    s.onerror = function() { _qrQueue.forEach(function(fn) { fn(); }); _qrQueue = []; };
    document.head.appendChild(s);
  }

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

  var _chartLoading = false, _chartLoaded = false, _chartQueue = [];
  function _loadChartJS(cb) {
    if (_chartLoaded) { cb(); return; }
    _chartQueue.push(cb);
    if (_chartLoading) return;
    _chartLoading = true;
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    s.onload = function() { _chartLoaded = true; _chartQueue.forEach(function(fn) { fn(); }); _chartQueue = []; };
    s.onerror = function() { _chartQueue.forEach(function(fn) { fn(); }); _chartQueue = []; };
    document.head.appendChild(s);
  }

  // ─── Steps/Stepper ───
  renderers.steps = renderers.stepper = function(container, data) {
    var items = Array.isArray(data) ? data : (data.steps || [data]);
    var h = '<div style="display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding:12px 0">';
    for (var i = 0; i < items.length; i++) {
      var s = items[i];
      var label = s.label || s.title || s.name || ('Step ' + (i + 1));
      var status = (s.status || 'pending').toLowerCase();
      var detail = s.detail || s.description || '';
      var isComplete = status === 'complete' || status === 'completed' || status === 'done';
      var isCurrent = status === 'current' || status === 'active' || status === 'in-progress';
      var circleColor = isComplete ? '#34d399' : isCurrent ? colors.accent : colors.border;
      var circleContent = isComplete ? '\\u2713' : String(i + 1);
      var textColor = isComplete || isCurrent ? colors.text : colors.textMuted;
      // Circle
      h += '<div style="display:flex;flex-direction:column;align-items:center;min-width:80px;flex:1">';
      h += '<div style="display:flex;align-items:center;width:100%">';
      if (i > 0) h += '<div style="flex:1;height:2px;background:' + (isComplete ? '#34d399' : colors.border) + '"></div>';
      else h += '<div style="flex:1"></div>';
      h += '<div style="width:28px;height:28px;border-radius:50%;background:' + circleColor + ';color:' + (isComplete || isCurrent ? '#fff' : colors.textMuted) + ';display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0">' + circleContent + '</div>';
      if (i < items.length - 1) h += '<div style="flex:1;height:2px;background:' + colors.border + '"></div>';
      else h += '<div style="flex:1"></div>';
      h += '</div>';
      h += '<div style="text-align:center;margin-top:6px;font-size:11px;font-weight:500;color:' + textColor + '">' + esc(label) + '</div>';
      if (detail) h += '<div style="text-align:center;font-size:10px;color:' + colors.textMuted + '">' + esc(detail) + '</div>';
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
    var bannerColors = { success: '#34d399', error: '#f87171', warning: '#fbbf24', info: colors.accent };
    var bc = bannerColors[type] || colors.accent;
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
      h += '<button onclick="(function(el){var s=el.closest(\'[id]\').querySelector(\'.slides\');var idx=+(s.dataset.idx||0);idx=idx>0?idx-1:' + (items.length - 1) + ';s.style.transform=\'translateX(-\'+idx*100+\'%)\';s.dataset.idx=idx})(this)" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px">\\u2039</button>';
      h += '<button onclick="(function(el){var s=el.closest(\'[id]\').querySelector(\'.slides\');var idx=+(s.dataset.idx||0);idx=idx<' + (items.length - 1) + '?idx+1:0;s.style.transform=\'translateX(-\'+idx*100+\'%)\';s.dataset.idx=idx})(this)" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px">\\u203A</button>';
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
      h += '<div style="cursor:pointer;overflow:hidden;border-radius:6px;aspect-ratio:1" onclick="(function(s,c){var o=document.createElement(\'div\');o.style.cssText=\'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:pointer\';o.onclick=function(){o.remove()};var img=document.createElement(\'img\');img.src=s;img.style.cssText=\'max-width:90%;max-height:85vh;border-radius:8px\';o.appendChild(img);if(c){var p=document.createElement(\'div\');p.style.cssText=\'color:#fff;font-size:13px;margin-top:8px\';p.textContent=c;o.appendChild(p)}document.body.appendChild(o)})(\'' + esc(full).replace(/'/g, "\\\\'") + '\',\'' + esc(caption).replace(/'/g, "\\\\'") + '\')">';
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
  var _leafletLoading = false, _leafletLoaded = false, _leafletQueue = [];
  function _loadLeaflet(cb) {
    if (_leafletLoaded) { cb(); return; }
    _leafletQueue.push(cb);
    if (_leafletLoading) return;
    _leafletLoading = true;
    // Load CSS
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.min.css';
    document.head.appendChild(link);
    // Load JS
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9/dist/leaflet.min.js';
    s.onload = function() { _leafletLoaded = true; _leafletQueue.forEach(function(fn) { fn(); }); _leafletQueue = []; };
    s.onerror = function() { _leafletQueue.forEach(function(fn) { fn(); }); _leafletQueue = []; };
    document.head.appendChild(s);
  }

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
  var _visLoading = false, _visLoaded = false, _visQueue = [];
  function _loadVisNetwork(cb) {
    if (_visLoaded) { cb(); return; }
    _visQueue.push(cb);
    if (_visLoading) return;
    _visLoading = true;
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/vis-network@9/standalone/umd/vis-network.min.js';
    s.onload = function() { _visLoaded = true; _visQueue.forEach(function(fn) { fn(); }); _visQueue = []; };
    s.onerror = function() { _visQueue.forEach(function(fn) { fn(); }); _visQueue = []; };
    document.head.appendChild(s);
  }

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

  // ── Public API ──

  window._photonRenderers = {
    render: function(container, data, format, opts) {
      if (!container) return;
      // Refresh colors from CSS vars on every render so theme changes are reflected
      colors = getColors();
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
