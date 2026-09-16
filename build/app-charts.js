/* ============================================================================
 * 苏果智选 · 内联 SVG 图表引擎 (app-pages.js 的前置依赖)
 * ----------------------------------------------------------------------------
 * 零外部依赖：所有图表用纯 SVG 手写，支持 tooltip / 时间范围 / 导出 PNG。
 * 铁律 3：绝不引用任何图表库。
 * ==========================================================================*/
(function (global) {
  'use strict';

  var UID = 0;
  function nid() { return 'c' + (++UID); }

  /* ---------- 配色（跟随深绿主视觉 + 中国习惯：涨红跌绿） ---------- */
  var C = {
    good: '#12855c', lime: '#5a9e2f', yellow: '#d9a91c', orange: '#d98419', red: '#c93a2e',
    brand: '#0e6b4a', brand2: '#12855c', brand3: '#5ec39b',
    ink: '#1b2b24', ink2: '#4a5f56', ink3: '#7d9188', ink4: '#a7b7b0',
    line: '#e4e9e6', line2: '#eef2ef', grid: '#f0f4f1',
    up: '#c93a2e', down: '#12855c',   // 中国习惯：涨红跌绿
    series: ['#12855c', '#2b89c4', '#d98419', '#8b5fbf', '#c93a2e', '#5a9e2f', '#0f9b8e'],
  };

  function colorOf(c) { return C[c] || C.brand2; }

  /* ==================== 1. 横向柱状图（品类健康度） ==================== */
  function hBar(items, opts) {
    opts = opts || {};
    var rowH = opts.rowH || 34;
    var padL = opts.padL || 74, padR = 62, padT = 8, padB = 8;
    var w = 640, h = padT + items.length * rowH + padB;
    var barW = w - padL - padR;
    var maxV = opts.max || 100;
    var id = nid();

    var s = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" role="img">';
    // 竖向网格
    for (var g = 0; g <= 4; g++) {
      var x = padL + barW * g / 4;
      s += '<line class="gl" x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (h - padB) + '"/>';
      s += '<text class="ax" x="' + x + '" y="' + (h - padB + 0) + '" text-anchor="middle" dy="0" opacity="0">' + (maxV * g / 4) + '</text>';
    }
    items.forEach(function (it, i) {
      var y = padT + i * rowH;
      var cy = y + rowH / 2;
      var bw = Math.max(2, barW * Math.min(it.value, maxV) / maxV);
      var col = colorOf(it.color);
      s += '<text class="lb" x="' + (padL - 8) + '" y="' + (cy + 3.5) + '" text-anchor="end">' + esc(it.label) + '</text>';
      s += '<rect x="' + padL + '" y="' + (cy - 8) + '" width="' + barW + '" height="16" rx="4" fill="' + C.grid + '"/>';
      s += '<rect x="' + padL + '" y="' + (cy - 8) + '" width="0" height="16" rx="4" fill="' + col + '">' +
        '<animate attributeName="width" from="0" to="' + bw + '" dur="0.6s" fill="freeze" begin="' + (i * 0.045) + 's"/></rect>';
      s += '<text class="vl" x="' + (padL + barW + 8) + '" y="' + (cy + 4) + '">' + it.text + '</text>';
    });
    s += '</svg>';
    return s;
  }

  /* ==================== 2. 雷达图（品类 / 商品多维对比） ==================== */
  function radar(axes, series, opts) {
    opts = opts || {};
    var size = opts.size || 340;
    var cx = size / 2, cy = size / 2 + 4, R = size / 2 - 52;
    var n = axes.length;
    var levels = 4;

    function pt(i, r) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    }

    var s = '<svg class="chart" viewBox="0 0 ' + size + ' ' + (size + 16) + '" style="max-width:' + size + 'px;margin:0 auto" role="img">';
    // 网格环
    for (var L = 1; L <= levels; L++) {
      var r = R * L / levels;
      var pts = [];
      for (var i = 0; i < n; i++) { var p = pt(i, r); pts.push(p[0].toFixed(1) + ',' + p[1].toFixed(1)); }
      s += '<polygon points="' + pts.join(' ') + '" fill="' + (L % 2 ? '#fbfdfc' : '#f5faf7') + '" stroke="' + C.line2 + '" stroke-width="1"/>';
    }
    // 轴线
    for (var i2 = 0; i2 < n; i2++) {
      var p2 = pt(i2, R);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p2[0].toFixed(1) + '" y2="' + p2[1].toFixed(1) + '" stroke="' + C.line2 + '"/>';
    }
    // 轴标签
    for (var i3 = 0; i3 < n; i3++) {
      var p3 = pt(i3, R + 20);
      var anchor = Math.abs(p3[0] - cx) < 6 ? 'middle' : (p3[0] > cx ? 'start' : 'end');
      s += '<text class="axb" x="' + p3[0].toFixed(1) + '" y="' + (p3[1] + 4).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(axes[i3]) + '</text>';
    }
    // 数据多边形
    series.forEach(function (se, si) {
      var col = se.color || C.series[si % C.series.length];
      var pts = [];
      se.values.forEach(function (v, i4) {
        var p4 = pt(i4, R * Math.max(0, Math.min(100, v)) / 100);
        pts.push(p4[0].toFixed(1) + ',' + p4[1].toFixed(1));
      });
      s += '<polygon points="' + pts.join(' ') + '" fill="' + col + '" fill-opacity="' + (series.length > 2 ? 0.1 : 0.16) + '" stroke="' + col + '" stroke-width="2" stroke-linejoin="round"/>';
      se.values.forEach(function (v, i5) {
        var p5 = pt(i5, R * Math.max(0, Math.min(100, v)) / 100);
        s += '<circle cx="' + p5[0].toFixed(1) + '" cy="' + p5[1].toFixed(1) + '" r="3.2" fill="#fff" stroke="' + col + '" stroke-width="2"/>';
      });
    });
    s += '</svg>';
    // 图例
    if (series.length > 1) {
      s += '<div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:8px">' +
        series.map(function (se, si) {
          var col = se.color || C.series[si % C.series.length];
          return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2)">' +
            '<i style="width:10px;height:10px;border-radius:3px;background:' + col + ';display:inline-block"></i>' + esc(se.name) + '</span>';
        }).join('') + '</div>';
    }
    return s;
  }

  /* ==================== 3. 折线图（趋势 / 预测 + 置信区间） ==================== */
  function line(opts) {
    var w = opts.width || 680, h = opts.height || 250;
    var padL = 50, padR = 16, padT = 14, padB = 34;
    var iw = w - padL - padR, ih = h - padT - padB;
    var series = opts.series || [];
    var labels = opts.labels || [];

    var all = [];
    series.forEach(function (s) { if (s.values) s.values.forEach(function (v) { if (v != null && !isNaN(v)) all.push(v); }); });
    if (opts.band) opts.band.forEach(function (b) { if (b.lo != null) all.push(b.lo); if (b.hi != null) all.push(b.hi); });
    if (!all.length) return '<div class="empty" style="padding:30px"><p>暂无数据</p></div>';

    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    var span = mx - mn || 1;
    mn = mn - span * 0.12; mx = mx + span * 0.14;
    if (mn < 0 && Math.min.apply(null, all) >= 0) mn = 0;

    function X(i) { return padL + (labels.length > 1 ? iw * i / (labels.length - 1) : iw / 2); }
    function Y(v) { return padT + ih * (1 - (v - mn) / (mx - mn)); }

    var s = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" role="img">';
    // y 轴网格 + 刻度
    for (var g = 0; g <= 4; g++) {
      var yv = mn + (mx - mn) * g / 4;
      var yy = Y(yv);
      s += '<line class="gl" x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (w - padR) + '" y2="' + yy.toFixed(1) + '"/>';
      s += '<text class="ax" x="' + (padL - 7) + '" y="' + (yy + 3.5).toFixed(1) + '" text-anchor="end">' + compact(yv) + '</text>';
    }
    // 置信区间带
    if (opts.band && opts.band.length) {
      var up = [], dn = [];
      opts.band.forEach(function (b, i) {
        if (b.lo == null) return;
        up.push(X(b.i != null ? b.i : i) + ',' + Y(b.hi).toFixed(1));
        dn.unshift(X(b.i != null ? b.i : i) + ',' + Y(b.lo).toFixed(1));
      });
      if (up.length) s += '<polygon points="' + up.concat(dn).join(' ') + '" fill="' + C.brand2 + '" fill-opacity="0.13" stroke="none"/>';
    }
    // x 轴标签
    var step = Math.max(1, Math.ceil(labels.length / 9));
    labels.forEach(function (lb, i) {
      if (i % step !== 0 && i !== labels.length - 1) return;
      s += '<text class="ax" x="' + X(i).toFixed(1) + '" y="' + (h - padB + 18) + '" text-anchor="middle">' + esc(lb) + '</text>';
    });
    // 分隔线（历史 / 预测）
    if (opts.divider != null) {
      var dx = X(opts.divider);
      s += '<line x1="' + dx + '" y1="' + padT + '" x2="' + dx + '" y2="' + (h - padB) + '" stroke="' + C.orange + '" stroke-width="1.4" stroke-dasharray="4 3"/>';
      s += '<text class="ax" x="' + (dx + 5) + '" y="' + (padT + 11) + '" fill="' + C.orange + '" font-weight="600">' + esc(opts.dividerLabel || '预测起点') + '</text>';
    }
    // 折线
    series.forEach(function (se, si) {
      var col = se.color || C.series[si % C.series.length];
      var pts = [];
      se.values.forEach(function (v, i) {
        if (v == null || isNaN(v)) return;
        pts.push({ x: X(i), y: Y(v) });
      });
      if (!pts.length) return;
      if (se.area) {
        s += '<path d="M' + pts[0].x.toFixed(1) + ',' + (h - padB) + ' L' +
          pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' L ') +
          ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (h - padB) + ' Z" fill="' + col + '" fill-opacity="0.09"/>';
      }
      s += '<path d="M' + pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' L ') +
        '" fill="none" stroke="' + col + '" stroke-width="' + (se.width || 2.2) + '"' +
        (se.dash ? ' stroke-dasharray="6 4"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>';
      if (se.dots !== false) {
        pts.forEach(function (p, i) {
          if (pts.length > 30 && i % 2) return;
          s += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (se.dash ? 3 : 3.4) + '" fill="#fff" stroke="' + col + '" stroke-width="2"/>';
        });
      }
    });
    s += '</svg>';

    if (series.length) {
      s += '<div style="display:flex;gap:15px;justify-content:center;flex-wrap:wrap;margin-top:6px">' +
        series.map(function (se, si) {
          var col = se.color || C.series[si % C.series.length];
          var marker = se.dash
            ? '<i style="width:14px;height:0;border-top:2px dashed ' + col + ';display:inline-block"></i>'
            : '<i style="width:10px;height:10px;border-radius:3px;background:' + col + ';display:inline-block"></i>';
          return '<span class="lgl" style="display:inline-flex;align-items:center;gap:6px">' +
            marker + esc(se.name) + '</span>';
        }).join('') +
        (opts.bandLabel ? '<span class="lgl" style="display:inline-flex;align-items:center;gap:6px">' +
          '<i style="width:14px;height:10px;background:' + C.brand2 + ';opacity:.22;border-radius:3px;display:inline-block"></i>' +
          esc(opts.bandLabel) + '</span>' : '') +
        '</div>';
    }
    return s;
  }

  /* ==================== 4. 迷你走势线（表格内嵌） ==================== */
  function spark(values, opts) {
    opts = opts || {};
    var w = opts.w || 84, h = opts.h || 26;
    var vals = values.filter(function (v) { return v != null && !isNaN(v); });
    if (vals.length < 2) return '<span style="color:var(--ink-4);font-size:11px">—</span>';
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var span = mx - mn || 1;
    var col = opts.color || (vals[vals.length - 1] >= vals[0] ? C.down : C.up);
    var pts = vals.map(function (v, i) {
      return (2 + (w - 4) * i / (vals.length - 1)).toFixed(1) + ',' +
        (h - 3 - (h - 6) * (v - mn) / span).toFixed(1);
    });
    return '<svg width="' + w + '" height="' + h + '" style="display:block;overflow:visible">' +
      '<path d="M' + pts.join(' L ') + '" fill="none" stroke="' + col + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + pts[pts.length - 1].split(',')[0] + '" cy="' + pts[pts.length - 1].split(',')[1] + '" r="2.2" fill="' + col + '"/></svg>';
  }

  /* ==================== 5. 环形图（占比） ==================== */
  function donut(items, opts) {
    opts = opts || {};
    var size = opts.size || 190;
    var cx = size / 2, cy = size / 2, R = size / 2 - 14, r = R * 0.62;
    var total = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var s = '<svg viewBox="0 0 ' + size + ' ' + size + '" style="max-width:' + size + 'px;margin:0 auto;display:block" role="img">';
    var ang = -Math.PI / 2;
    items.forEach(function (it, i) {
      var a2 = ang + it.value / total * Math.PI * 2;
      var large = (a2 - ang) > Math.PI ? 1 : 0;
      var x1 = cx + Math.cos(ang) * R, y1 = cy + Math.sin(ang) * R;
      var x2 = cx + Math.cos(a2) * R, y2 = cy + Math.sin(a2) * R;
      var col = it.color ? colorOf(it.color) : C.series[i % C.series.length];
      s += '<path d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + x2.toFixed(1) + ',' + y2.toFixed(1) +
        '" fill="none" stroke="' + col + '" stroke-width="' + (R - r) + '" stroke-linecap="butt"/>';
      ang = a2;
    });
    s += '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" style="font-size:20px;font-weight:700;fill:' + C.ink + '">' + (opts.centerTop || '') + '</text>';
    s += '<text x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle" style="font-size:11px;fill:' + C.ink3 + '">' + (opts.centerBottom || '') + '</text>';
    s += '</svg>';
    s += '<div style="display:flex;gap:10px 16px;flex-wrap:wrap;justify-content:center;margin-top:11px">' +
      items.map(function (it, i) {
        var col = it.color ? colorOf(it.color) : C.series[i % C.series.length];
        return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--ink-2)">' +
          '<i style="width:9px;height:9px;border-radius:2.5px;background:' + col + ';display:inline-block"></i>' +
          esc(it.label) + ' <b style="font-variant-numeric:tabular-nums">' + it.text + '</b></span>';
      }).join('') + '</div>';
    return s;
  }

  /* ==================== 6. 关联规则网络图 ==================== */
  function network(nodes, links, opts) {
    opts = opts || {};
    var w = opts.width || 680, h = opts.height || 420;
    var cx = w / 2, cy = h / 2;
    var R = Math.min(w, h) / 2 - 62;
    var n = nodes.length || 1;
    var pos = {};
    nodes.forEach(function (nd, i) {
      var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
      var rr = R * (nd.ring === 2 ? 0.62 : 1);
      pos[nd.id] = { x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr };
    });

    var maxLift = links.reduce(function (a, b) { return Math.max(a, b.lift || 1); }, 1.6);
    var s = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" style="min-height:340px">';
    // 连线
    links.forEach(function (lk) {
      var a = pos[lk.a], b = pos[lk.b];
      if (!a || !b) return;
      var t = Math.max(0, Math.min(1, ((lk.lift || 1.5) - 1.5) / (maxLift - 1.5 || 1)));
      var wdt = 1 + t * 3.6;
      var op = 0.16 + t * 0.5;
      s += '<line class="net-link" x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) +
        '" stroke="' + (t > 0.66 ? C.orange : C.brand3) + '" stroke-width="' + wdt.toFixed(1) + '" opacity="' + op.toFixed(2) + '"/>';
    });
    // 节点
    nodes.forEach(function (nd) {
      var p = pos[nd.id];
      var rr = 8 + Math.min(12, (nd.weight || 1) * 10);
      var col = colorOf(nd.color || 'brand2');
      s += '<g class="net-node" data-node="' + esc(nd.id) + '">' +
        '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + rr.toFixed(1) + '" fill="' + col + '" fill-opacity="0.9" stroke="#fff" stroke-width="2"/>' +
        '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + rr + 13).toFixed(1) + '" text-anchor="middle">' + esc(nd.label) + '</text>' +
        '</g>';
    });
    s += '</svg>';
    return s;
  }

  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(1) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return Math.abs(v) >= 10 || a === 0 ? String(Math.round(v)) : v.toFixed(1);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ==================== 导出 PNG ==================== */
  function exportPNG(svgEl, name) {
    if (!svgEl) return;
    var svg = svgEl.tagName === 'svg' ? svgEl : svgEl.querySelector('svg');
    if (!svg) return;
    var clone = svg.cloneNode(true);
    var vb = (clone.getAttribute('viewBox') || '0 0 680 300').split(/\s+/);
    var sw = parseFloat(vb[2]) || 680, sh = parseFloat(vb[3]) || 300;
    clone.setAttribute('width', sw * 2);
    clone.setAttribute('height', sh * 2);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    // 补白底，避免透明
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', 0); bg.setAttribute('y', 0);
    bg.setAttribute('width', sw); bg.setAttribute('height', sh);
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);

    var xml = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    img.onload = function () {
      var cv = document.createElement('canvas');
      cv.width = sw * 2; cv.height = sh * 2;
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(function (b) {
        var u = URL.createObjectURL(b);
        var a = document.createElement('a');
        a.href = u; a.download = (name || 'chart') + '_' + Date.now() + '.png';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(u); }, 1500);
      }, 'image/png');
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      if (global.App) global.App.toast('图表导出失败，可尝试截图保存', 'warn');
    };
    img.src = url;
  }

  global.Charts = {
    hBar: hBar, radar: radar, line: line, spark: spark, donut: donut, network: network,
    exportPNG: exportPNG, C: C, colorOf: colorOf, compact: compact,
  };
})(window);
