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
  renderers['chart'] = renderers['chart:bar'] = renderers['chart:line'] = renderers['chart:pie'] = renderers['chart:area'] = renderers['chart:donut'] = function(container, data, opts, formatKey) {
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
